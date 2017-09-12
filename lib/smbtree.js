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
var async = require('async');
var _ = require('lodash');
var path = require('path');

var SMBFile = require('./smbfile');
var common = require('./common');
var utils = require('./utils');
var ntstatus = require('./ntstatus');

/**
 * Represents a tree connection established by <code>TREE_CONNECT_ANDX</code> or <code>SMB2 TREE_CONNECT</code>
 *
 * @param {SMBTreeConnection} smbTreeConnection
 * @param {Tree} spiTree
 * @param {SMBContext} context
 * @constructor
 */
function SMBTree(smbTreeConnection, spiTree, context) {
  this.treeConnection = smbTreeConnection;
  this.spiTree = spiTree;
  this.context = context;
  this.smbServer = smbTreeConnection.smbServer;
  this.smbShare = smbTreeConnection.smbShare;
}

SMBTree.prototype.getShare = function () {
  return this.treeConnection.getShare();
};

SMBTree.prototype.getFile = function (fid) {
  return this.treeConnection.getFileInstance(this.spiTree, this, fid);
};

SMBTree.prototype.closeFile = function (fid, cb) {
  var file = this.getFile(fid);
  if (!file) {
    process.nextTick(function () { cb(new Error('no such file')); });
  } else {
    this.treeConnection.clearFile(fid);
    file.close(cb);
  }
};

/**
 * Test whether or not the specified file exists.
 *
 * @param {String} name file name
 * @param {Function} cb callback called with the result
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {Boolean} cb.exists true if the file exists; false otherwise
 */
SMBTree.prototype.exists = function (name, cb) {
  this.spiTree.exists(utils.normalizeSMBFileName(name), cb);
};

/**
 * Open or create an existing file/directory.
 *
 * @param {String} name file name
 * @param {Number} createDisposition flag specifying action if file does/does not exist
 * @param {Boolean} openTargetDirectory true if target for open is a directory
 * @param {Function} cb callback called with the opened file
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {SMBFile} cb.file opened file
 */
SMBTree.prototype.openOrCreate = function (name, createDisposition, openTargetDirectory, cb) {
  var self = this;

  name = utils.normalizeSMBFileName(name);

  function create(callback) {
    var createFn = openTargetDirectory ? self.createDirectory : self.createFile;
    createFn.call(self, name, callback);
  }

  function open(callback) {
    self.spiTree.open(name, function (err, file) {
      if (err) {
        callback(err);
        return;
      }
      // todo what's the exact difference between consts.FILE_SUPERSEDE and consts.FILE_OVERWRITE_IF ?
      var openAction;
      if (createDisposition === common.FILE_OVERWRITE
        || createDisposition === common.FILE_OVERWRITE_IF
        || createDisposition === common.FILE_SUPERSEDE) {
        openAction = common.FILE_OVERWRITTEN;
      } else {
        openAction = common.FILE_OPENED;
      }
      var result = self.treeConnection.createFileInstance(self, file, openAction);
      if (openAction === common.FILE_OVERWRITTEN) {
        result.setLength(0, function (err) {
          callback(err, result);
        });
      } else {
        callback(null, result);
      }
    });
  }

  if (createDisposition === common.FILE_OPEN || createDisposition === common.FILE_OVERWRITE) {
    // open existing
    open(cb);
  } else if (createDisposition === common.FILE_CREATE) {
    // create new
    create(cb);
  } else {
    // conditional create/open (consts.FILE_SUPERSEDE, consts.FILE_OPEN_IF, consts.FILE_OVERWRITE_IF)
    self.exists(name, function (err, exists) {
      if (err) {
        cb(err);
        return;
      }
      if (exists) {
        open(cb);
      } else {
        create(cb);
      }
    });
  }
};

/**
 * Open an existing file/directory.
 *
 * @param {String} name file name
 * @param {Function} cb callback called with the opened file
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {SMBFile} cb.file opened file
 */
SMBTree.prototype.open = function (name, cb) {
  var self = this;
  this.spiTree.open(utils.normalizeSMBFileName(name), function (err, file) {
    if (err) {
      cb(err);
    } else {
      cb(null, self.treeConnection.createFileInstance(self, file, common.FILE_OPENED));
    }
  });
};

/**
 * Reopen an existing file/directory using an already assigned fid.
 * Special purpose method called when an already open SMBFile instance
 * is renamed in order to make sure that the internal state of the
 * wrapped File instance is consistent with the new path/name.
 *
 * @param {String} name file name
 * @param {Number} fid file ID
 * @param {Function} cb callback called with the opened file
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {SMBFile} cb.file reopened file
 */
SMBTree.prototype.reopen = function (name, fid, cb) {
  var self = this;
  this.spiTree.open(utils.normalizeSMBFileName(name), function (err, file) {
    if (err) {
      cb(err);
    } else {
      cb(null, self.treeConnection.createFileInstance(self, file, common.FILE_OPENED));
    }
  });
};

/**
 * List entries, matching a specified pattern.
 *
 * @param {String} pattern pattern
 * @param {Function} cb callback called with an array of matching files
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {SMBFile[]} cb.files array of matching files
 */
SMBTree.prototype.list = function (pattern, cb) {
  var npattern = utils.normalizeSMBFileName(pattern);
  var self = this;
  this.spiTree.list(npattern, function (err, files) {
    if (err) {
      cb(err);
    } else {
      var results = files.map(function (file) {
        return new SMBFile(file, self);
      });
      cb(null, results);
      if (utils.getPathName(npattern) === '*') {
        // emit event
        self.smbServer.emit('folderListed', self.smbShare.getName(), utils.getParentPath(npattern));
      }
    }
  });
};

/**
 * Create a new file.
 *
 * @param {String} name file name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {SMBFile} cb.file created file
 */
SMBTree.prototype.createFile = function (name, cb) {
  var self = this;
  var nname = utils.normalizeSMBFileName(name);

  this.spiTree.createFile(nname, function (err, file) {
    if (err) {
      cb(err);
      return;
    }
    cb(null, self.treeConnection.createFileInstance(self, file, common.FILE_CREATED));

    self.notifyChangeListeners(common.FILE_ACTION_ADDED, nname);

    // emit event
    self.smbServer.emit('fileCreated', self.smbShare.getName(), nname);
  });
};

/**
 * Create a new directory.
 *
 * @param {String} name directory name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {SMBFile} cb.file created directory
 */
SMBTree.prototype.createDirectory = function (name, cb) {
  var self = this;
  var nname = utils.normalizeSMBFileName(name);

  this.spiTree.createDirectory(nname, function (err, file) {
    if (err) {
      cb(err);
      return;
    }
    cb(null, self.treeConnection.createFileInstance(self, file, common.FILE_CREATED));

    self.notifyChangeListeners(common.FILE_ACTION_ADDED, nname);

    // emit event
    self.smbServer.emit('folderCreated', self.smbShare.getName(), nname);
  });
};

/**
 * Delete a file.
 *
 * @param {String} name file name
 * @param {Function} cb callback called with the result
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {Boolean} cb.deleted true if the file could be deleted; false otherwise
 */
SMBTree.prototype.delete = function (name, cb) {
  var self = this;
  var nname = utils.normalizeSMBFileName(name);

  this.spiTree.delete(nname, function (err) {
    cb(err);
    if (!err) {
      self.notifyChangeListeners(common.FILE_ACTION_REMOVED, nname);

      // emit event
      self.smbServer.emit('fileDeleted', self.smbShare.getName(), nname);
    }
  });
};

/**
 * Delete a directory. It must be empty in order to be deleted.
 *
 * @param {String} name directory name
 * @param {Function} cb callback called with the result
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {Boolean} cb.deleted true if the directory could be deleted; false otherwise
 */
SMBTree.prototype.deleteDirectory = function (name, cb) {
  var self = this;
  var nname = utils.normalizeSMBFileName(name);

  this.spiTree.deleteDirectory(nname, function (err) {
    cb(err);
    if (!err) {
      self.notifyChangeListeners(common.FILE_ACTION_REMOVED, nname);

      // emit event
      self.smbServer.emit('folderDeleted', self.smbShare.getName(), nname);
    }
  });
};

/**
 * Rename a file or directory.
 *
 * @param {String|SMBFile} nameOrFile name of target file or target file
 * @param {String} newName new name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
SMBTree.prototype.rename = function (nameOrFile, newName, cb) {
  var self = this;

  var targetFID;
  var oldName;
  if (typeof nameOrFile === 'string') {
    oldName = nameOrFile;
  } else {
    targetFID = nameOrFile.getId();
    oldName = nameOrFile.getPath();
  }
  var nOldName = utils.normalizeSMBFileName(oldName);
  var nNewName = utils.normalizeSMBFileName(newName);

  // todo check if source has uncommitted changes (i.e. needs flush)
  // todo check if source has deleteOnClose set
  this.spiTree.rename(nOldName, nNewName, function (err) {
    if (err) {
      cb(err);
      return;
    }
    if (targetFID) {
      self.reopen(nNewName, targetFID, cb);
    } else {
      cb();
    }

    self.notifyChangeListeners(common.FILE_ACTION_RENAMED, nOldName, nNewName);

    // emit event
    self.smbServer.emit('itemMoved', self.smbShare.getName(), nOldName, nOldName);
  });
};

/**
 * Flush the contents of all open files.
 *
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
SMBTree.prototype.flush = function (cb) {
  this.treeConnection.flush(this, this.spiTree, cb);
};

/**
 * Refresh a specific folder.
 *
 * @param {String} folderPath
 * @param {Boolean} deep
 * @param {Function} cb callback called on completion
 * @param {String|Error} cb.error error (non-null if an error occurred)
 */
SMBTree.prototype.refresh = function (folderPath, deep, cb) {
  var self = this;
  // give SPI impl a chance to invalidate cache
  this.spiTree.refresh(folderPath, deep, function (err) {
    if (err) {
      cb(err);
    } else {
      // dummy change notification to force client to refresh
      var p = path.join(folderPath, '/'); // append trailing / to folder path (to make sure the proper listener is selected)
      self.notifyChangeListeners(common.FILE_ACTION_MODIFIED, p);
      cb();
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
SMBTree.prototype.registerChangeListener = function (mid, file, deep, completionFilter, cb) {
  this.treeConnection.registerChangeListener(mid, file, deep, completionFilter, cb);
};

/**
 * Notify the appropriate listener (if there is one) for some change
 * and remove it from the collection of registered listeners (one shot notification).
 *
 * @param {Number} action file action
 * @param {String} name name of file that changed
 * @param {String} [newName] optional, new name of file in case of a rename
 */
SMBTree.prototype.notifyChangeListeners = function (action, name, newName) {
  this.treeConnection.notifyChangeListeners(action, name, newName);
};

/**
 * Cancel the specified listener.
 *
 * @param {Number} mid - multiplex id (msg.header.mid, identifies an SMB request within an SMB session)
 * @return {Function} cancelled listener callback or null
 */
SMBTree.prototype.cancelChangeListener = function (mid) {
  this.treeConnection.cancelChangeListener(mid);
};

/**
 * Clears the tree's cache.
 * @param {function} cb Will be invoked when the operation is complete.
 * @param {string|Error} cb.err Will be truthy if there were errors during the operation.
 */
SMBTree.prototype.clearCache = function (cb) {
  var self = this;
  if (self.spiTree) {
    self.spiTree.clearCache(cb);
  } else {
    logger.debug('cannot clear cache because spiTree is not an object');
    cb();
  }
};

module.exports = SMBTree;
