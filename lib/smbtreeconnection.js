/*
 *  Copyright 2015 Adobe Systems Incorporated. All rights reserved.
 *  This file is licensed to you under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License. You may obtain a copy
 *  of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software distributed under
 *  the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 *  OF ANY KIND, either express or implied. See the License for the specific language
 *  governing permissions and limitations under the License.
 */

'use strict';

var logger = require('winston').loggers.get('default');
var _ = require('lodash');
var path = require('path');

var common = require('./common');
var utils = require('./utils');
var ntstatus = require('./ntstatus');
var SMBTree = require('./smbtree');
var SMBFile = require('./smbfile');
var SMBFileConnection = require('./smbfileconnection');

// timeout in ms after which a NT_TRANSACT_NOTIFY_CHANGE request will be replied with a dummy change notification.
// after receiving such a change notification the client (i.e. Finder on os-x) will send a TRANS2_FIND_FIRST2 cmd to refresh.
var CHANGE_LISTENER_TIMEOUT = 5000; // todo FIXME use configured refresh interval

/**
 * Represents a tree connection established by <code>TREE_CONNECT_ANDX</code> or <code>SMB2 TREE_CONNECT</code>
 *
 * @param {SMBServer} smbServer
 * @param {SMBShare} smbShare
 * @param {TreeConnection} spiTreeConnection
 * @constructor
 */
function SMBTreeConnection(smbServer, smbShare, spiTreeConnection) {
  this.smbServer = smbServer;
  this.smbShare = smbShare;
  this.spiTreeConnection = spiTreeConnection;
  this.tid = ++SMBTreeConnection.tidCounter;

  this.files = {};
  this.listeners = {};
}

SMBTreeConnection.tidCounter = 0;
SMBTreeConnection.fidCounter = 0;

SMBTreeConnection.prototype.createTree = function (context) {
  return new SMBTree(this, this.spiTreeConnection.createTree(context), context);
};

SMBTreeConnection.prototype.getShare = function () {
  return this.smbShare;
};

/**
 * Retrieves an SMBFile instance for a previously opened file.
 * @param {Tree} spiTree SPI Tree to use to create the instance.
 * @param {SMBTree} smbTree SMB Tree to be used by the instance.
 * @param {Number} fid ID of the file to retrieve.
 * @returns {SMBFile} Instance representing the given file id.
 */
SMBTreeConnection.prototype.getFileInstance = function (spiTree, smbTree, fid) {
  if (this.files[fid]) {
    var smbFileConnection = this.files[fid];
    var spiFile = smbFileConnection.createFileInstance(spiTree);
    return new SMBFile(spiFile, smbTree, smbFileConnection);
  } else {
    return null;
  }
};

/**
 * Creates a new SMBFile instance from an SPI File and stores the file by its ID.
 * @param {SMBTree} smbTree Will be used by the SMBFile instance.
 * @param {File} spiFile Will be given to the SMBFile instance.
 * @param {Number} openAction Represents how the file originated.
 * @returns {SMBFile} The newly created instance.
 */
SMBTreeConnection.prototype.createFileInstance = function (smbTree, spiFile, openAction) {
  var fid = ++SMBTreeConnection.fidCounter;
  this.files[fid] = new SMBFileConnection(this.smbServer, this.smbShare, this, spiFile.getFileConnection(), fid, openAction);
  return new SMBFile(spiFile, smbTree, this.files[fid]);
};

/**
 * Removes a stored file. This does not delete the file from the server.
 * @param {Number} fid ID of the file to remove.
 */
SMBTreeConnection.prototype.clearFile = function (fid) {
    delete this.files[fid];
};

/**
 * Disconnect this tree.
 */
SMBTreeConnection.prototype.disconnect = function () {
  var self = this;
  // cancel any pending change listeners
  _.forOwn(this.listeners, function (listener, mid) {
    self.cancelChangeListener(mid);
  });
  // delegate to spi
  this.spiTreeConnection.disconnect(function (err) {
    if (err) {
      logger.error('tree disconnect failed:', err);
    }
  });
};

/**
 * Register a one-shot notification listener that will send a NT_TRANSACT_NOTIFY_CHANGE response.
 *
 * see https://msdn.microsoft.com/en-us/library/ee442155.aspx
 *
 * @param {Number} mid - multiplex id (msg.header.mid, identifies an SMB request within an SMB session)
 * @param {SMBFile} file - directory to watch for changes
 * @param {Boolean} deep - watch all subdirectories too
 * @param {Number} completionFilter - completion filter bit flags
 * @param {Function} cb - callback to be called on changes
 * @param {Number} cb.action - file action
 * @param {String} cb.name - name of file that changed
 * @param {String} [cb.newName] - optional, new name if this was a rename
 */
SMBTreeConnection.prototype.registerChangeListener = function (mid, file, deep, completionFilter, cb) {
  var self = this;
  var listener = {
    mid: mid,
    path: file.getPath(),
    deep: deep,
    completionFilter: completionFilter,
    cb: cb
  };
  // auto refresh after timeout if no change (via SMB server) occurred within specified period
  listener.autoRefreshTimer = setTimeout(
    function () {
      // dummy change notification to force client to refresh
      var p = path.join(listener.path, '/'); // append trailing / to folder path (to make sure the proper listener is selected)
      self.notifyChangeListeners(common.FILE_ACTION_MODIFIED, p);
    },
    CHANGE_LISTENER_TIMEOUT
  );

  this.listeners[mid] = listener;
};

/**
 * Notify the appropriate listener (if there is one) for some change
 * and remove it from the collection of registered listeners (one shot notification).
 *
 * @param {Number} action file action
 * @param {String} name name of file that changed
 * @param {String} [newName] optional, new name of file in case of a rename
 */
SMBTreeConnection.prototype.notifyChangeListeners = function (action, name, newName) {

  function trimListenerPath(name, listener) {
    return name.substr(listener.path.length + ((listener.path === '/') ? 0 : 1));
  }

  function getSearchPredicate(path) {
    return function (listener, mid) {
      // todo evaluate listener.completionFilter WRT action
      return (!listener.deep && utils.getParentPath(path) === listener.path)
        || (listener.deep && path.indexOf(listener.path) === 0);
    };
  }

  var listener = _.find(this.listeners, getSearchPredicate(name));
  var listenerNew;
  if (action === common.FILE_ACTION_RENAMED) {
    // rename
    listenerNew = _.find(this.listeners, getSearchPredicate(newName));
    if (listener || listenerNew) {
      if (listener === listenerNew) {
        // in-place rename: same listener for both old and new name
        listener.cb(action, name.substr(listener.path.length + 1), trimListenerPath(newName, listener));
      } else if (listener && listenerNew) {
        // there's separate listeners for old and new name
        listener.cb(common.FILE_ACTION_RENAMED_OLD_NAME, trimListenerPath(name, listener));
        listenerNew.cb(common.FILE_ACTION_RENAMED_NEW_NAME, trimListenerPath(newName, listenerNew));
      } else if (listener) {
        // there's only a listener for old name
        listener.cb(common.FILE_ACTION_RENAMED_OLD_NAME, trimListenerPath(name, listener));
      } else {
        // there's only a listener for new name
        listenerNew.cb(common.FILE_ACTION_RENAMED_NEW_NAME, trimListenerPath(newName, listenerNew));
      }
    }
  } else {
    // not a rename
    if (listener) {
      listener.cb(action, trimListenerPath(name, listener));
    }
  }

  // one shot notification, cancel listeners
  if (listener) {
    this.cancelChangeListener(listener.mid);
  }
  if (listenerNew) {
    this.cancelChangeListener(listenerNew.mid);
  }
};

/**
 * Cancel the specified listener.
 *
 * @param {Number} mid - multiplex id (msg.header.mid, identifies an SMB request within an SMB session)
 * @return {Function} cancelled listener callback or null
 */
SMBTreeConnection.prototype.cancelChangeListener = function (mid) {
  var result = this.listeners[mid];
  if (result) {
    if (result.autoRefreshTimer) {
      // cancel auto refresh timer
      clearTimeout(result.autoRefreshTimer);
    }
    delete this.listeners[mid];
  }
  return result;
};

/**
 * Flush the contents of all open files.
 *
 * @param {SMBTree} Will be used to interact with files while flushing.
 * @param {Tree} Will be used to interact with files while flushing.
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
SMBTreeConnection.prototype.flush = function (smbTree, spiTree, cb) {
  var self = this;
  async.forEachOf(this.files,
    function (file, fid, callback) {
      var flushFile = this.getFileInstance(spiTree, smbTree, fid);
      flushFile.flush(callback);
    },
    cb);
};

module.exports = SMBTreeConnection;
