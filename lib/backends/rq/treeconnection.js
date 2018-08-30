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

var util = require('util');
var logger = require('../../logging').getLogger('spi');
var rqlog = require('../../logging').getLogger('rq');
var Path = require('path');

var JCR = require('../jcr/constants');
var TreeConnection = require('../../spi/treeconnection');
var RQTree = require('./tree');
var RequestQueue = require('./requestqueue');
var RQProcessor = require('./rqprocessor');
var FSTreeConnection = require('../fs/treeconnection');
var FSShare = require('../fs/share');
var utils = require('../../utils');

/**
 * Creates an instance of TreeConnection.
 *
 * @constructor
 * @this {TreeConnection}
 */
var RQTreeConnection = function (share, remote, options) {
  if (!(this instanceof RQTreeConnection)) {
    return new RQTreeConnection(share, remote, options);
  }
  TreeConnection.call(this, share.config);
  options = options || {};

  var self = this;
  this.options = options;
  this.remoteTreeConnection = remote;
  this.share = share;
  this.localTreeConnection = new FSTreeConnection(new FSShare('rqlocal', share.config.local));
  this.rq = new RequestQueue({
    path: share.config.work.path
  });
  this.rq.on('requestchanged', function (data) {
    share.emitShareEvent('modificationqueueitemchanged', data);
  });

  this.processor = new RQProcessor(this, share.config);

  this.processor.on('error', function (err) {
    logger.error('there was a general error in the processor', err);
    share.emitShareEvent('syncerr', {err: err});
  });

  this.processor.on('purged', function (purged) {
    logger.info('failed files were purged from the queue', purged);
    share.emitShareEvent('syncpurged', {files: purged});
  });

  this.share.on('autoUploadChanged', function (eventData) {
    logger.debug('Treeconnection recieved an  Auto Upload changed event with %s', eventData.options.autoUpload);
    self.processor.setAutoUpload(eventData.options.autoUpload);
  });
  this.share.on('uploadAllPending', function (eventData) {
    logger.debug('Treeconnection  recieved uploadAllPending');
    self.processor.syncAll(share.config, function(err) {
    });
  });

  this.share.on('uploadasset', function (eventDataObj) {
    var eventData = eventDataObj.options;
    var log = eventDataObj.context ? eventDataObj.context.spi() : logger;
    if (!eventData.path) {
      log.error('uploadasset event requires a path to upload');
    } else {
      self.processor.syncPath(eventData.path, {
        remotePrefix: self.share.getRemotePrefix(),
        localPrefix: self.share.getLocalPrefix(),
        isDelete: eventData.isDelete
      });
    }
  });

  this.share.on('downloadasset', function (eventData) {
    _downloadAsset.call(self, eventData.context, eventData.options, eventData.callback);
  });

  this.share.on('createasset', function (eventDataObj) {
    var eventData = eventDataObj.options;
    var log = eventDataObj.context ? eventDataObj.context.spi() : logger;
    if (!eventData.path) {
      log.error('createasset event requires a path to upload');
    } else {
      self.share.createFileResource(self.createTree(eventDataObj.context), eventData.path, eventData.file, {
        fromOffset: eventData.fromOffset,
        onChunk: eventData.onChunk,
        includeLocalPath: true
      }, eventDataObj.callback || function () {});
    }
  });

  this.share.on('deleteasset', function (eventData) {
    var log = eventData.context ? eventData.context.spi() : logger;
    if (!eventData.options || !eventData.options.path) {
      log.error('deleteasset event requires a path to delete');
    } else {
      self.share.deleteResource(self.createTree(eventData.context), eventData.options.path, true, eventData.callback);
    }
  });

  this.share.on('checkcache', function (eventData) {
    var log = eventData.context ? eventData.context.spi() : logger;
    log.debug('tree connection received event checkcachesize');
    var tree = self.createTree(eventData.context);
    tree.checkCacheSizeAndConflicts(eventData.options.maxCacheSize, eventData.options.forceEvent, eventData.options.findConflicts);
  });

  this.share.on('cancelupload', function (eventData) {
    self.share.cancelUpload(eventData.options.path);
  });

  this.share.on('isdownloaded', function (eventData) {
    _isAssetDownloaded.call(self, eventData.context, eventData.options, eventData.callback);
  });

  this.share.on('getlinkedassets', function (eventData) {
    _getLinkedAssets.call(self, eventData.context, eventData.options, eventData.callback);
  });

  this.share.on('submitrequest', function (eventData) {
    self.share.submitRequest(eventData.context, eventData.options, eventData.callback);
  });

  this.share.on('pathexists', function (eventData) {
    var log = eventData.context ? eventData.context.spi() : logger;
    var proceed = true;
    if (!eventData.options || !eventData.options.path) {
      log.error('pathexists event requires a path to create');
      proceed = false;
    }
    if (!eventData.callback) {
      log.error('pathexists event requires a callback');
      proceed = false;
    }
    if (proceed) {
      self.share.resourceExists(self.createTree(eventData.context), eventData.options.path, eventData.callback);
    }
  });

  this.share.on('createdirectory', function (eventData) {
    var log = eventData.context ? eventData.context.spi() : logger;
    var proceed = true;
    if (!eventData.options || !eventData.options.path) {
      log.error('createdirectory event requires a path to create');
      proceed = false;
    }
    if (!eventData.callback) {
      log.error('createdirectory event requires a callback');
      proceed = false;
    }
    if (proceed) {
      self.share.createDirectoryResource(self.createTree(eventData.context), eventData.options.path, eventData.callback);
    }
  });

  this.share.on('getmodificationqueue', function (eventData) {
    var log = eventData.context ? eventData.context.spi() : logger;
    if (!eventData.callback) {
      log.error('getmodificationqueue event requires a callback');
    } else {
      var callback = eventData.callback;
      self.rq.getAllRequests(eventData.context, function (err, requests) {
        if (err) {
          callback(err);
          return;
        }

        var toSend = [];
        for (var i = 0; i < requests.length; i++) {
          toSend.push({
            path: Path.join(requests[i].path, requests[i].name),
            method: requests[i].method,
            timestamp: requests[i].timestamp
          });
        }
        callback(null, toSend);
      });
    }
  });

  if (!options.noprocessor && (share.config.autoUpload)) {
    this.processor.start(share.config);
  }
};

util.inherits(RQTreeConnection, TreeConnection);

function _getLinkedAssets(context, data, callback) {
  var path = data.path;
  var assets = [];
  var logger = context.spi();

  if (path.charAt(path.length - 1) != '/') {
    path += '/';
  }

  path = '/content/dam' + path + 'jcr:content/metadata/xmpMM:Ingredients.1.json';

  logger.debug('submitting request for linked assets using path %s', path);

  var options = {
    headers: {}
  };
  options.headers[JCR.ACTION_HEADER] = JCR.ACTION_LINKEDASSETS;

  var self = this;
  self.share.getPathContent(context, path, options, function (err, resp, body) {
    if (err) {
      callback(err);
      return;
    }

    logger.debug('received status code %s for linked assets request', resp.statusCode);

    if (resp.statusCode == 200) {
      var xmpIngredients;
      try {
        xmpIngredients = JSON.parse(body)
      } catch (e) {
        logger.error('cannot convert xmp ingredients response to json', e);
        callback('unable to interpret xmp ingredients as json');
        return;
      }
      for (var key in xmpIngredients) {
        logger.debug('processing XMP key %s', key);
        if (xmpIngredients[key]['stRef:filePath']) {
          var path = xmpIngredients[key]['stRef:filePath'];

          var filePrefix = 'file:';
          var filePrefixLen = filePrefix.length + 2; // include slashes
          if (path.length > filePrefixLen) {
            if (path.substr(0, filePrefix.length) == filePrefix) {
              path = path.substr(filePrefixLen);
              if (path.match(/^\/[a-zA-Z]:\//g)) {
                // handle Windows paths, which require an extra / to be trimmed from front
                path = path.substr(1);
              }
            }
          }

          path = utils.normalizePathSeparator(path);
          logger.debug('adding linked asset from XMP key %s: %s', key, path);
          assets.push(path);
        }
      }
      callback(null, assets);
    } else {
      callback(null, assets);
    }
  });
}

function _isAssetDownloaded(context, data, callback) {
  var self = this;
  var tree = self.createTree(context);
  var path = data.path;

  if (callback) {
    tree.local.exists(data.path, callback);
  }
}

function _downloadAsset(context, data, callback) {
  var self = this;
  var tree = self.createTree(context);
  var logger = tree.getLogger();
  var path = data.path;

  function handleExists(callback) {
    tree.local.exists(path, function (err, exists) {
      if (err) {
        logger.error('unable to download file %s to local cache due to error', path, err);
        return;
      }

      if (exists) {
        if (data.force) {
          tree.local.delete(path, function (err) {
            if (err) {
              logger.error('unable to re-download file %s to local cache due to error', path, err);
              return;
            }
            callback();
          });
        } else {
          _invokeCallback();
        }
      } else {
        callback();
      }
    });
  }

  function _invokeCallback(err) {
    logger.debug('_invokeCallback: entering');
    if (callback) {
      logger.debug('_invokeCallback: invoking callback');
      callback(err);
    }
  }

  handleExists(function () {
    logger.info('downloading file %s to local cache by request of server', path);
    tree.local.download(tree.remote, path, function (err) {
      if (err) {
        logger.error('unable to download file %s to local cache due to error', path, err);
        _invokeCallback(err);
      } else {
        logger.info('successfully downloaded file %s to local cache by request of server', path);
        _invokeCallback();
      }
    });
  });
};

/**
 * Creates a new Tree instance that can be used for interacting with the tree.
 * @param {SMBContext} context The context that will be given to the tree.
 */
RQTreeConnection.prototype.createTree = function (context) {
  return new RQTree(this, context, this.remoteTreeConnection.createTree(context), this.localTreeConnection.createTree(context));
};

/**
 * Disconnect this tree.
 *
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
RQTreeConnection.prototype.disconnect = function (cb) {
  rqlog.debug('RQTree.disconnect');
  var self = this;
  if (!self.options.noprocessor) {
    self.processor.stop();
  }
  self.remoteTreeConnection.disconnect(function (remoteErr) {
    self.localTreeConnection.disconnect(function (localErr) {
      if (remoteErr || localErr) {
        var err = [];
        if (remoteErr) {
          err.push(remoteErr);
        }
        if (localErr) {
          err.push(localErr);
        }
        cb(err);
      } else {
        cb();
      }
    });
  });
};

module.exports = RQTreeConnection;
