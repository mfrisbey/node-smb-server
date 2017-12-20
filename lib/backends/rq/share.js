/*
 *  Copyright 2016 Adobe Systems Incorporated. All rights reserved.
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

var unorm = require('unorm');

var Share = require('../../spi/share');
var RQTreeConnection = require('./treeconnection');
var RQRemoteShare = require('./remoteshare');

/**
 * Creates an instance of RQShare.
 *
 * @constructor
 * @this {RQShare}
 * @param {String} name share name
 * @param {Object} config configuration hash
 */
var RQShare = function (name, config) {
  if (!(this instanceof RQShare)) {
    return new RQShare(name, config);
  }
  var self = this;
  this.config = config || {};
  this.listCache = {};
  this.contentCacheTTL = typeof config.contentCacheTTL === 'number' ? config.contentCacheTTL : 30000; // default: 30s

  this.remote = new RQRemoteShare(name, config);
  this.waits = {};
  this.downloadingFiles = {};

  self.remote.on('shareEvent', function (data) {
    self.emit('shareEvent', data);
  });

  Share.call(this, name, config);
};

// the RQShare prototype inherits from Share
util.inherits(RQShare, Share);

RQShare.prototype.isExtensionMode = function () {
  return (this.getConfig().mode == 'extension');
};

RQShare.prototype.getLocalPrefix = function () {
  return this.config.local.path;
};

RQShare.prototype.getRemotePrefix = function () {
  return this.buildResourceUrl('');
};

RQShare.prototype.notifyDownloadComplete = function (tree, path) {
  var logger = tree.getLogger();
  var self = this;
  if (self.waits[path]) {
    var i;
    for (i = 0; i < self.waits[path].length; i++) {
      // invoke waiting callback
      var waitCallback = self.waits[path][i].callback;
      var waitTree = self.waits[path][i].tree;

      logger.info('%s download complete, notifying waiting thread %s', path, waitTree.getRequestId());
      logger.info('%s download complete, wait callback invoked', path);

      waitCallback();
    }
    self.waits[path] = [];
  }
};

RQShare.prototype.waitOnDownload = function (tree, path, cb) {
  var logger = tree.getLogger();
  var self = this;
  if (self.isDownloading(tree, path)) {
    logger.debug('%s is downloading, waiting for completion', path);
    // wait for download
    if (!self.waits[path]) {
      self.waits[path] = [];
    }
    logger.info('waiting on file %s to download', path);
    self.waits[path].push({ tree: tree, callback: cb });
  } else {
    // not downloading, return immediately
    cb();
  }
};

RQShare.prototype.isDownloading = function (tree, path) {
  if (!tree.isTempFileName(path)) {
    return this.downloadingFiles[path] ? true : false;
  } else {
    // temp files are never downloading
    return false;
  }
};

RQShare.prototype.setDownloading = function (tree, path, isDownloading) {
  var wasDownloading = this.isDownloading(tree, path);
  this.downloadingFiles[path] = isDownloading;
  if (wasDownloading && !isDownloading) {
    // the file is no longer downloading. remove lock
    this.notifyDownloadComplete(tree, path);
  }
};

RQShare.prototype.invalidateContentCache = function (tree, path, deep) {
  var rqlog = tree.getRqLogger();
  rqlog.debug('RQShare.invalidateContentCache %s', path);
  if (this.remote.invalidateContentCache) {
    this.remote.invalidateContentCache(tree, path, deep);
  }
  this.listCache[path] = undefined;
};

RQShare.prototype.getListCache = function (path, tree, cb) {
  var rqlog = tree.getRqLogger();
  if (this.listCache[path]) {
    var now = new Date().getTime();

    if (now - this.listCache[path].timestamp > this.contentCacheTTL) {
      // cache is expired
      rqlog.debug('RQShare.getListCache cache expired %s', path);
      this.listCache[path] = undefined;
      cb();
    } else {
      // cache is valid
      var cache = this.listCache[path].files;
      var addFile = function (index, files) {
        if (index < cache.length) {
          tree.open(cache[index], function (err, rqFile) {
            if (err) {
              cb(err);
            } else {
              files.push(rqFile);
              addFile(index + 1, files);
            }
          });
        } else {
          cb(null, files);
        }
      };
      addFile(0, []);
    }
  } else {
    cb();
  }
};

RQShare.prototype.cacheList = function (path, files) {
  var names = [];
  for (var i = 0; i < files.length; i++) {
    names.push(files[i].getPath());
  }
  this.listCache[path] = {timestamp: new Date().getTime(), files: names};
};

RQShare.prototype.buildResourceUrl = function (path) {
  return this.remote.buildResourceUrl(path);
};

RQShare.prototype.fetchResource = function (context, path, cb) {
  this.remote.fetchResource(context, path, cb);
};

RQShare.prototype.resourceExists = function (tree, path, cb) {
  this.remote.resourceExists(tree, path, cb);
};

RQShare.prototype.applyRequestDefaults = function(tree, opts, url) {
  return this.remote.applyRequestDefaults(tree, opts, url);
};

RQShare.prototype.createTree = function (remoteTree, config) {
  return new RQTreeConnection(this, remoteTree, config);
};

RQShare.prototype.emitSyncConflict = function (fileName) {
  this.emitShareEvent('syncconflict', { path: fileName });
};

function _cacheFile(filePath, localTree, remoteTree, refresh, cb) {
  var logger = localTree.getLogger();
  logger.debug('local file %s does not exist. fetching from remote', filePath);
  localTree.download(remoteTree, filePath, {refresh: refresh}, cb);
}

/**
 * Determines if a given file has been cached and needs to be updated.
 * @param {RQFile} file The file to check.
 * @param {Function} cb Will be invoked when the operation is complete.
 * @param {Object} cb.err Will be truthy if there were errors during the operation.
 * @param {Boolean} cb.needsUpdate Will be true if the file needs to be updated, otherwise false.
 * @private
 */
function _cacheNeedsUpdate(rqTree, remoteTree, localFile, cb) {
  var logger = rqTree.getLogger();
  var rqlog = rqTree.getRqLogger();
  var filePath = localFile.getPath();

  function closeFile(file, callback) {
    file.close(function (err) {
      if (err) {
        logger.error('unexpected error while trying to close remote file after checking whether cache needs to be updated', err);
      }
      callback();
    });
  };

  if (localFile.isCreatedLocally()) {
    logger.debug('file %s was created locally, no need to update', filePath);
    cb(null, false);
  } else {
    logger.debug('file %s was cached from remote, check to see if it needs to be updated', filePath);
    rqlog.debug('RQFile.cacheFile.remote.open %s', filePath);
    remoteTree.open(rqTree.remoteEncodePath(filePath), function (err, remoteFile) {
      if (err) {
        logger.info('error while attempting to open cached remote file, not attemting to update', err);
        cb(null, false);
      } else {
        var remoteModified = remoteFile.lastModified();
        closeFile(remoteFile, function () {
          logger.debug('%s comparing cached remote modified (%d) with current remote modified (%d)', filePath, localFile.getDownloadedRemoteModifiedDate(), remoteModified);
          cb(null, (localFile.getDownloadedRemoteModifiedDate() != remoteModified));
        });
      }
    });
  }
};

/**
 * Updates a locally cached file if it can be deleted.
 * @param {RQTree} rqTree The tree initiating the operation.
 * @param {RQLocalTree} localTree The tree to use for caching.
 * @param {RQRemoteTree} remoteTree The tree to use to retrieve the file.
 * @param {RQLocalFile} localFile The existing file that should be replaced.
 * @param {Function} cb Will be invoked when the operation is complete.
 * @param {Object} cb.err Will be truthy if there were errors.
 * @param {RQLocalFile} cb.file If not null, the newly cached file. If null, the file could not be updated.
 * @private
 */
function _updateCache(rqTree, localTree, remoteTree, localFile, cb) {
  var logger = rqTree.getLogger();
  var self = this;
  var filePath = localFile.getPath();
  localFile.canDelete(function (err, canDelete) {
    if (err) {
      cb(err);
    } else if (!canDelete) {
      logger.debug('file %s cannot be safely deleted. check to see if it is in the queue', filePath);
      rqTree.queueDataExists(filePath, function (err, exists) {
        if (err) {
          cb(err);
        } else {
          if (!exists) {
            logger.info('file %s is in conflict', filePath);
            self.emitSyncConflict(filePath);
          }
          cb();
        }
      });
    } else {
      logger.info('file %s is being re-cached', filePath);
      _cacheFile.call(self, filePath, localTree, remoteTree, true, function (err, file) {
        if (err) {
          logger.info('encountered error while attempting to re-cache file %s. keeping previous file', filePath);
          cb();
        } else {
          cb(null, file);
        }
      });
    }
  });
}

/**
 * If necessary, caches a remote file locally for use in cached operations.
 * @param {Function} cb callback called after caching is complete
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File} cb.file If not null, the newly cached File instance. If null, no caching was done.
 */
RQShare.prototype.cacheFile = function (rqFile, cb) {
  if (this.isExtensionMode()) {
    cb();
    return;
  }
  var logger = rqFile.getLogger();
  var rqlog = rqFile.getRqLogger();

  var self = this;
  var rqTree = rqFile.tree;
  var localTree = rqTree.local;
  var remoteTree = rqTree.remote;
  var filePath = rqFile.filePath;

  rqlog.debug('RQShare.cacheFile %s', filePath);

  function closeFile(file, callback) {
    file.close(function (err) {
      if (err) {
        logger.error('unexpected error while closing file when attempting to cache locally', err);
      }
      callback();
    });
  }

  if (rqTree.isTempFileName(filePath)) {
    logger.debug('%s is a temporary file, do not attempt to cache it', filePath);
    cb();
  } else {
    self.waitOnDownload(rqTree, filePath, function (err) {
      if (err) {
        cb(err);
      } else {
        localTree.exists(filePath, function (err, exists) {
          if (err) {
            cb(err);
          } else if (exists) {
            localTree.open(filePath, function (err, localFile) {
              if (err) {
                cb(err);
              } else {
                // file has already been cached. check to see if it needs to be updated
                _cacheNeedsUpdate.call(self, rqTree, remoteTree, localFile, function (err, needsUpdate) {
                  if (err) {
                    closeFile(localFile, function () {
                      cb(err);
                    });
                  } else if (needsUpdate) {
                    _updateCache.call(self, rqTree, localTree, remoteTree, localFile, function (err, file) {
                      closeFile(localFile, function () {
                        cb(err, file);
                      });
                    });
                  } else {
                    // file is already cached but no update is needed
                    closeFile(localFile, function () {
                      logger.info('%s using cached file', filePath);
                      cb();
                    });
                  }
                });
              }
            });
          } else {
            _cacheFile.call(self, filePath, localTree, remoteTree, false, cb);
          }
        });
      }
    });
  }
};

//--------------------------------------------------------------------< Share >

/**
 *
 * @param {Session} session
 * @param {Buffer|String} shareLevelPassword optional share-level password (may be null)
 * @param {Function} cb callback called with the connect tree
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {Tree} cb.tree connected tree
 */
RQShare.prototype.connect = function (session, shareLevelPassword, cb) {
  var self = this;
  self.remote.connect(session, shareLevelPassword, function (err, remoteTree) {
    if (err) {
      cb(err);
    } else {
      cb(null, self.createTree(remoteTree, self.config));
    }
  });
};

RQShare.prototype.onServerEvent = function (context, eventName, data) {
  data['context'] = context;
  this.emit(eventName, data);
};

/**
 * Encodes a path in a unicode format acceptable for sending to the remote host.
 * @param {String} path The path to be encoded.
 * @returns {String} The encoded path.
 */
RQShare.prototype.remoteEncodePath = function (path) {
  if (!this.config.noUnicodeNormalize) {
    return unorm.nfkc(path);
  } else {
    return path;
  }
};

module.exports = RQShare;
