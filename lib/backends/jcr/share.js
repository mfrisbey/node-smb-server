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

// enable DNS caching, which will improve performance of HTTP requests because there will not need to be a DNS lookup
// for every request. node.js does not provide DNS caching capabilities by default.
require('dnscache')({
  'enable': true,
  'ttl': 300,
  'cachesize': 1000
});

var fs = require('fs');
var Path = require('path');
var Util = require('util');
var stream = require('stream');

var _ = require('lodash');
var async = require('async');
var wlogger = require('../../logging').getLogger('spi');

var Share = require('../../spi/share');
var FSShare = require('../fs/share');
var JCRTreeConnection = require('./treeconnection');
var JCR = require('./constants');
var utils = require('../../utils');
var webutils = require('../../webutils');
var ntstatus = require('../../ntstatus');
var SMBError = require('../../smberror');
var mkdirp = require('mkdirp');

/**
 * Creates an instance of JCRShare.
 *
 * @constructor
 * @this {JCRShare}
 * @param {String} name share name
 * @param {Object} config configuration hash
 */
var JCRShare = function (name, config) {
  if (!(this instanceof JCRShare)) {
    return new JCRShare(name, config);
  }
  config = config || {};

  Share.call(this, name, config);

  this.host = config.host;
  this.port = config.port || 80;
  this.auth = config.auth;
  this.path = config.path;
  this.protocol = config.protocol || 'http:';
  this.maxSockets = config.maxSockets || 32;

  // path prefix for .<depth>.json requests
  //this.jsonServletPath = ''; // Sling Default Get Servlet
  this.jsonServletPath = '/crx/server/crx.default/jcr%3aroot'; // DAVEX

  this.description = config.description || '';

  // TTL before all caches will be cleared
  this.allCacheClear = Date.now();
  this.allCacheTTL = typeof config.allCacheTTL === 'number' ? config.allCacheTTL : 1800000; // default: 30m
  // TTL in ms for content cache entries
  this.contentCacheTTL = typeof config.contentCacheTTL === 'number' ? config.contentCacheTTL : 30000; // default: 30s
  // TTL in ms for cached binaries
  this.binCacheTTL = typeof config.binCacheTTL === 'number' ? config.binCacheTTL : 300000; // default: 5m
  this.cachedFolderListings = {};
  this.cachedFileEntries = {};
  this.cachedBinaries = {};
  this.lastLongDownload = 0;
  this.uploads = {};
  this.downloads = {};
  this.shareTemp = null;
};

// the JCRShare prototype inherits from Share
Util.inherits(JCRShare, Share);

JCRShare.prototype.temp = function () {
  if (!this.shareTemp) {
    this.shareTemp = require('temp');
    this.shareTemp.track(); // cleanup on exit
    if (this.config.tmpDir) {
      // allow temp dir location to be configured - there can be issues on moving temp files if the temp dir and
      // cache are on different partitions
      try {
        mkdirp.sync(this.config.tmpDir);
        this.shareTemp.dir = this.config.tmpDir;
      } catch (e) {
        wlogger.error('unable to create temp directory %s, using default os temp dir location', this.config.tmpDir, e);
      }
    }
  }
  return this.shareTemp;
};

JCRShare.prototype.isFilePrimaryType = function (primaryType) {
  return [ JCR.NT_FILE ].indexOf(primaryType) > -1;
};

JCRShare.prototype.isDirectoryPrimaryType = function (primaryType) {
  return [ JCR.NT_FOLDER, JCR.SLING_FOLDER, JCR.SLING_ORDEREDFOLDER ].indexOf(primaryType) > -1;
};

JCRShare.prototype.parseContentChildEntries = function (content, iterator) {
  var self = this;
  _.forOwn(content, function(entry, nm) {
    if (typeof entry === 'object' && entry[JCR.JCR_PRIMARYTYPE]
      && (self.isFilePrimaryType(entry[JCR.JCR_PRIMARYTYPE])
      || self.isDirectoryPrimaryType(entry[JCR.JCR_PRIMARYTYPE]))) {
      iterator(nm, entry);
    }
  });
};

JCRShare.prototype.buildUrlRoot = function () {
  return this.protocol + '//' + this.host + ':' + this.port;
};

JCRShare.prototype.buildContentUrl = function (path, depth) {
  return this.buildUrlRoot() + this.jsonServletPath + encodeURI(utils.normalizeSMBFileName(Path.join(this.path, path))) + '.' + depth + '.json';
};

JCRShare.prototype.buildResourceUrl = function (path) {
  return this.buildUrlRoot() + encodeURI(utils.normalizeSMBFileName(Path.join(this.path, path)));
};

JCRShare.prototype.buildResourcePath = function (path) {
  return this.path + encodeURI(utils.normalizeSMBFileName(path));
};

JCRShare.prototype.getContent = function (tree, path, deep, forceCacheRefresh, cb) {
  // support previous versions of the function that did not have forceRefresh parameter
  if (typeof forceCacheRefresh === 'function') {
    cb = forceCacheRefresh;
    forceCacheRefresh = false;
  }

  var logger = wlogger;

  if (tree) {
    logger = tree.getLogger();
  }

  // clear all caches periodically to ensure that memory consumption remains in check
  if (Date.now() - this.allCacheClear >= this.allCacheTTL) {
    logger.debug('clearing all content caches');
    this.cachedFolderListings = {};
    this.cachedFileEntries = {};
    this.cachedBinaries = {};
    this.allCacheClear = Date.now();
  }
  var cache = deep ? this.cachedFolderListings : this.cachedFileEntries;
  var result = cache[path];
  if (result) {
    if (Date.now() - result.fetched <= this.contentCacheTTL && !forceCacheRefresh) {
      //logger.debug('returning cached content %s', path);
      cb(null, result);
      return;
    } else {
      delete cache[path];
    }
  }

  var self = this;
  logger.debug('fetching content %s, deep=%s', path, deep);
  this.fetchContent(tree, path, deep, function (err, content) {
    if (err) {
      cb(err);
      return;
    }
    if (content) {
      // cached root never expires
      content.fetched = path === Path.sep && !deep ? Number.MAX_SAFE_INTEGER : Date.now();
      cache[path] = content;
      //logger.debug('cached content %s', path);
      if (deep) {
        // populate self.cachedFileEntries with child entries
        self.parseContentChildEntries(content, function (childName, childContent) {
          childContent.fetched = Date.now();
          var childPath = self.unicodeNormalize(Path.join(path, childName));
          self.cachedFileEntries[childPath] = childContent;
          //logger.debug('cached content %s', childPath);
        });
      }
    } else {
      // content not found: invalidate stale cache entries
      if (tree) {
        self.invalidateContentCache(tree, path, deep);
      }
    }
    cb(null, content);
  });
};

function getSyncFileData(remotePath, method, localPath, err) {
  var data = {
    path: remotePath
  };
  if (method) {
    data['method'] = method;
  }
  if (localPath) {
    data['file'] = localPath;
  }
  if (err) {
    data['err'] = err;
  }
  return data;
}

/**
 * Sends an event indicating that the share has begun uploading a file.
 * @param {String} remotePath Server path of a file.
 * @param {String} method An HTTP method.
 * @param {string} [localPath] If specified, the local path to the file being synced.
 */
JCRShare.prototype.emitSyncFileStart = function (remotePath, method, localPath) {
  this.emitShareEvent('syncfilestart', getSyncFileData(remotePath, method, localPath));
};

/**
 * Sends an event indicating that the share has finished uploading a file.
 * @param {String} remotePath Server path of a file.
 * @param {String} method An HTTP method.
 * @param {string} [localPath] If specified, the local path to the file being synced.
 */
JCRShare.prototype.emitSyncFileEnd = function (remotePath, method, localPath) {
  this.emitShareEvent('syncfileend', getSyncFileData(remotePath, method, localPath));
};

/**
 * Sends an event indicating that the share has encountered an error uploading a file.
 * @param {String} remotePath Server path of a file.
 * @param {String} localPath Full local path of a file.
 * @param {String} method An HTTP method.
 * @param {Error} err An error message.
 * @param {string} [localPath] If specified, the local path to the file being synced.
 */
JCRShare.prototype.emitSyncFileError = function (remotePath, method, err, localPath) {
  this.emitShareEvent('syncfileerr', getSyncFileData(remotePath, method, localPath, (err.message || err)));
};

/**
 * Sends an event indicating that the share has made progress while uploading a file.
 * @param {Object} progressData Will be sent as-is as the event's data.
 */
JCRShare.prototype.emitSyncFileProgress = function (progressData) {
  this.emitShareEvent('syncfileprogress', progressData);
};

/**
 * Adds a given path to the share's list of currently active uploads.
 * @param {String} remotePath Server path of a file.
 * @param {HTTPRequest} req The request corresponding to the transfer.
 */
JCRShare.prototype.registerUploadRequest = function (remotePath, req) {
  this.uploads[remotePath] = req;
};

/**
 * Adds a given path to the share's list of currently active downloads.
 * @param {String} remotePath Server path of a file.
 * @param {HTTPRequest} req The request corresponding to the transfer.
 */
JCRShare.prototype.registerDownloadRequest = function (remotePath, req) {
  this.downloads[remotePath] = req;
};

function _cancel(target, remotePath, deep, cancelCb) {
  if (deep) {
    if (remotePath != '/' && remotePath.charAt(remotePath.length - 1) != '/') {
      remotePath += '/';
    }
    for (var property in target) {
      if (property.length > remotePath.length) {
        if (property.substr(0, remotePath.length) == remotePath) {
          target[property].abort();
          cancelCb(property);
        }
      }
    }
  } else if (target[remotePath]) {
    target[remotePath].abort();
    cancelCb(remotePath);
  }
}

/**
 * Cancels one of the share's currently active uploads.
 * @param {String} remotePath Server path of a file.
 * @param {Boolean} deep If true, all children of the given path will be canceled.
 */
JCRShare.prototype.cancelUpload = function (remotePath, deep) {
  var self = this;
  _cancel(this.uploads, remotePath, deep, function (cancelPath) {
    self.emitShareEvent('syncfileabort', {path: cancelPath });
    self.unregisterUploadRequest(cancelPath);
  });
};

/**
 * Cancels one of the share's currently active downloads.
 * @param {String} remotePath Server path of a file.
 * @param {Boolean} deep If true, all children of the given path will be canceled.
 */
JCRShare.prototype.cancelDownload = function (remotePath, deep) {
  var self = this;
  _cancel(this.downloads, remotePath, deep, function (cancelPath) {
    self.emitShareEvent('downloadabort', {path: cancelPath });
    self.unregisterDownloadRequest(cancelPath);
  });
};

/**
 * Removes a path from the share's list of active uploads.
 * @param {String} remotePath Server path of a file.
 */
JCRShare.prototype.unregisterUploadRequest = function (remotePath) {
  delete this.uploads[remotePath];
};

/**
 * Removes a path from the share's list of active downloads.
 * @param {String} remotePath Server path of a file.
 */
JCRShare.prototype.unregisterDownloadRequest = function (remotePath) {
  delete this.downloads[remotePath];
};

/**
 * Aborts any currently uploading or downloading requests.
 */
JCRShare.prototype.cancelAllTransfers = function () {
  for (var path in this.uploads) {
    this.cancelUpload(path, false);
  }

  for (var path in this.downloads) {
    this.cancelDownload(path, false);
  }
};

/**
 * Updates a remote file by uploading the contents of a local file to the remote server.
 * @param {Tree} tree Tree whose logger will be used for log messages.
 * @param {String} remotePath The server path of the resource to update.
 * @param {String} localPath Full local path to the file to upload.
 * @param {Function} cb Invoked when the operation is complete.
 * @param {Error} cb.err Truthy if there were errors.
 * @param {Object} cb.stats Stat information for the local file.
 */
JCRShare.prototype.updateResource = function (tree, remotePath, localPath, cb) {
  this._updateResource(tree, this.unicodeNormalize(remotePath), this.unicodeNormalize(localPath), cb);
};

/**
 * Implementation of updateResource. Should be overridden by child classes.
 * @private
 */
JCRShare.prototype._updateResource = function (tree, remotePath, localPath, cb) {
  var logger = tree.getLogger();
  var self = this;
  logger.debug('[%s] share.updateResource %s', this.config.backend, remotePath);
  var method = 'PUT';

  function sendCallback(err, stats) {
    self.unregisterUploadRequest(remotePath);
    if (err) {
      var doEmit = false;
      if (err.error) {
        doEmit = !(err.ignoreEmit);
        err = err.error;
      }
      if (doEmit) {
        self.emitSyncFileError(remotePath, method, err);
      }
      cb(err);
    } else {
      self.emitSyncFileEnd(remotePath, method);
      cb(undefined, stats);
    }
  }

  // deferred write (spool local tmp file to server)
  var url = this.buildResourceUrl(remotePath);
  var options = this.applyRequestDefaults(tree, {
    url: url,
    method: method,
    headers: {
      'Content-Type': utils.lookupMimeType(remotePath)
    }
  });
  options.headers[JCR.ACTION_HEADER] = JCR.ACTION_UPDATEFILE;
  fs.fstat(localPath, function (err, stats) {
    if (err) {
      sendCallback(SMBError.fromSystemError(err, 'error while trying to stat file'));
    } else {
      this.emitSyncFileStart(remotePath, method);
      var read = fs.createReadStream(localPath);
      webutils.monitorTransferProgress(read, remotePath, stats.size, function (progress) {
        this.emitSyncFileProgress(progress);
      });
      var req = webutils.submitRequest(options, function (err, resp, body) {
        if (err) {
          logger.error('failed to spool %s to %s', localPath, remotePath, err);
          sendCallback(SMBError.fromSystemError(err, 'unable to submit request due to unexpected error'));
        } else if (resp.statusCode !== 200 && resp.statusCode !== 204) {
          logger.error('failed to spool %s to %s - %s %s [%d]', localPath, remotePath, options.method, url, resp.statusCode, body);
          sendCallback(new SMBError(ntstatus.STATUS_UNSUCCESSFUL, 'unable to sync local changes due to unexpected status code ' + resp.statusCode));
        } else {
          // succeeded
          // invalidate content cache
          self.invalidateContentCache(tree, remotePath, false);
          // touch cache entry
          self.touchLocalFile(tree, remotePath, stats.mtime.getTime(), function (err) {
            sendCallback(SMBError.fromSystemError(err, 'error while touching local file'), stats);
          });
        }
      });
      req.on('abort', function () {
        logger.info('upload of path %s was aborted', remotePath);
        var error = new SMBError(ntstatus.STATUS_UNSUCCESSFUL, 'upload was aborted');
        error.aborted = true;
        sendCallback({error: error, ignoreEmit: true});
      });
      self.registerUploadRequest(remotePath, req);
      read.pipe(req);
    }
  });
};

/**
 * Analyzes the response to a delete resource request and determines if there were errors.
 * @param {String} path The server path of a resource.
 * @param {HTTPResponse} resp The response to a delete request.
 * @returns {SMBError} Truthy if there was an error, otherwise false.
 */
JCRShare.prototype.getDeleteResourceError = function (path, resp) {
  if (resp.statusCode === 404) {
    return new SMBError(ntstatus.STATUS_NO_SUCH_FILE, 'unable to delete file because it does not exist');
  } else if (resp.statusCode !== 204) {
    return new SMBError(ntstatus.STATUS_UNSUCCESSFUL, 'unable to delete file due to ' + resp.statusCode + ' status code');
  }
  return false;
};

/**
 * Deletes a resource from the remote server.
 * @param {Tree} tree Will be used for logging messages.
 * @param {String} path The server path of a resource.
 * @param {Boolean} isFile True if the target is a file, false otherwise.
 * @param {Function} cb Invoked when the operation is complete.
 * @param {Error} cb.err Truthy if there were errors.
 * @return {HTTPRequest} The request that will be used to delete the resource.
 */
JCRShare.prototype.deleteResource = function (tree, path, isFile, cb) {
  return this._deleteResource(tree, this.unicodeNormalize(path), isFile, cb);
};

/**
 * Implementation of deleteResource. Should be overridden by child classes.
 * @private
 */
JCRShare.prototype._deleteResource = function (tree, path, isFile, cb) {
  var logger = tree.getLogger();
  logger.debug('[%s] share.deleteResource %s', this.config.backend, path);

  var url = this.buildResourceUrl(path);
  var options = this.applyRequestDefaults(tree, {
    url: url,
    method: 'DELETE',
    headers: {}
  });
  options.headers[JCR.ACTION_HEADER] = JCR.ACTION_DELETE;

  if (isFile) {
    this.emitSyncFileStart(path, 'DELETE');
  }

  var self = this;
  return webutils.submitRequest(options, function (err, resp, body) {
    if (err) {
      logger.error('failed to delete %s', path, err);
      if (isFile) {
        self.emitSyncFileError(path, 'DELETE', err);
      }
      cb(SMBError.fromSystemError(err, 'unable to delete file due to unexpected error'));
    } else {
      var delErr = self.getDeleteResourceError(path, resp);
      if (delErr) {
        logger.error('failed to delete %s - %s %s [%d]', path, options.method, options.url, resp.statusCode, body);
        if (isFile) {
          self.emitSyncFileError(path, 'DELETE', err);
        }
        cb(delErr);
        return;
      }
      // succeeded
      // invalidate cache
      self.invalidateContentCache(tree, path, false);
      if (isFile) {
        self.emitSyncFileEnd(path, 'DELETE');
      }
      cb();
    }
  });
};

/**
 * Applies additional options that should be included a create file http request. Some options are set automatically,
 * including the URL and content type, so those will already be present in the supplied options.
 * @param {Object} options The options set by default by the share.
 * @returns {Object} The modified options object.
 */
JCRShare.prototype.applyCreateFileResourceRequestOptions = function (options) {
  return options;
};

/**
 * Creates a file resource on the remote server by uploading a local file.
 * @param {Tree} tree Will be used for logging messages.
 * @param {String} remotePath The server path of a resource.
 * @param {String} localPath Full path to a local file.
 * @param [Object] options Optional settings to control the creation process.
 * @param {Function} cb Invoked when the operation is complete.
 * @param {Error} cb.err Truthy if there were errors.
 */
JCRShare.prototype.createFileResource = function (tree, remotePath, localPath, options, cb) {
  this._createFileResource(tree, this.unicodeNormalize(remotePath), this.unicodeNormalize(localPath), options, cb);
};

/**
 * Implementation of createFileResource. Should be overridden by child classes.
 * @private
 */
JCRShare.prototype._createFileResource = function (tree, remotePath, localPath, options, cb) {
  if (typeof options === 'function') {
    cb = options;
    options = {};
  }

  var logger = tree.getLogger();
  logger.debug('[%s] share.createFileResource %s', this.config.backend, remotePath);

  var url = this.buildResourceUrl(remotePath);
  var options = this.applyCreateFileResourceRequestOptions(this.applyRequestDefaults(tree, {
    url: url,
    method: 'PUT',
    headers: {
      'Content-Type': utils.lookupMimeType(remotePath)
    }
  }));
  options.headers[JCR.ACTION_HEADER] = JCR.ACTION_CREATEFILE;

  var self = this;

  var emptyStream = new stream.PassThrough();
  emptyStream.end(new Buffer(0));
  emptyStream.pipe(
    webutils.submitRequest(options, function (err, resp, body) {
      if (err) {
        logger.error('failed to create %s', remotePath, err);
        cb(SMBError.fromSystemError(err, 'unable to create file due to unexpected error'));
      } else if (resp.statusCode === 409) {
        cb(new SMBError(ntstatus.STATUS_OBJECT_NAME_COLLISION, 'unable to create file because it already exists'));
      } else if (resp.statusCode !== 201) {
        logger.error('failed to create %s - %s %s [%d]', remotePath, options.method, options.url, resp.statusCode, body);
        cb(new SMBError(ntstatus.STATUS_UNSUCCESSFUL, 'unable to create file due to ' + resp.statusCode + ' status code'));
      } else {
        // succeeded
        // invalidate cache
        self.invalidateContentCache(tree, utils.getParentPath(remotePath), true);
        cb();
      }
    })
  );
};

/**
 * Applies additional options that should be included a create directory http request. Some options are set automatically,
 * including the URL, so those will already be present in the supplied options.
 * @param {Object} options The options set by default by the share.
 * @returns {Object} The modified options object.
 */
JCRShare.prototype.applyCreateDirectoryResourceRequestOptions = function (options) {
  return options;
};

/**
 * Creates a directory resource on the remote server.
 * @param {Tree} tree Will be used for logging message.
 * @param {String} path The server path of the resource.
 * @param {Function} cb Invoked when the operation is complete.
 * @param {Error} cb.err Truthy if there were errors.
 * @return {HTTPRequest} The request that will create the directory.
 */
JCRShare.prototype.createDirectoryResource = function (tree, path, cb) {
  return this._createDirectoryResource(tree, this.unicodeNormalize(path), cb);
};

/**
 * Implementation of createDirectoryResource. Should be overridden by child classes.
 * @private
 */
JCRShare.prototype._createDirectoryResource = function (tree, path, cb) {
  var logger = tree.getLogger();
  logger.debug('[%s] share.createDirectoryResource %s', this.config.backend, path);

  var url = this.buildResourceUrl(path);
  var self = this;
  var options = this.applyCreateDirectoryResourceRequestOptions(this.applyRequestDefaults(tree, {
    url: url,
    method: 'MKCOL',
    headers: {}
  }));
  options.headers[JCR.ACTION_HEADER] = JCR.ACTION_CREATEFOLDER;

  return webutils.submitRequest(options, function (err, resp, body) {
    if (err) {
      logger.error('failed to create %s', path, err);
      cb(SMBError.fromSystemError(err, 'unable to create directory due to unexpected error'));
    } else if (resp.statusCode === 409) {
      cb(new SMBError(ntstatus.STATUS_OBJECT_NAME_COLLISION, 'unable to create directory because it already exists'));
    } else if (resp.statusCode !== 201) {
      logger.error('failed to create %s - %s %s [%d]', path, options.method, options.url, resp.statusCode, body);
      cb(new SMBError(ntstatus.STATUS_UNSUCCESSFUL, 'unable to create directory due to ' + resp.statusCode + ' status code'));
    } else {
      // succeeded
      // invalidate cache
      self.invalidateContentCache(tree, utils.getParentPath(path), true);
      cb();
    }
  });
};

/**
 * Applies additional options that should be included a rename http request. Some options are set automatically,
 * including the URL, so those will already be present in the supplied options.
 * @param {Object} options The options set by default by the share.
 * @returns {Object} The modified options object.
 */
JCRShare.prototype.applyRenameResourceRequestOptions = function (newName, options) {
  options['headers'] = options.headers || {};
  options.headers['Destination'] = this.buildResourcePath(newName);
  options.headers['Depth'] = 'infinity';
  options.headers['Overwrite'] = 'F';
  return options;
};

/**
 * Renames a resource in the remote server.
 * @param {Tree} tree Will be used for logging messages.
 * @param {String} oldName The server path of a resource. Source path of the rename.
 * @param {String} newName The server path of the resource. Target path of the rename.
 * @param {Function} cb Invoked when the operation is complete.
 * @param {Error} cb.err Truthy if there were errors during the operation.
 */
JCRShare.prototype.renameResource = function (tree, oldName, newName, cb) {
  this._renameResource(tree, this.unicodeNormalize(oldName), this.unicodeNormalize(newName), cb);
};

/**
 * Implementation of renameResource. Should be overridden by child classes.
 * @private
 */
JCRShare.prototype._renameResource = function (tree, oldName, newName, cb) {
  var self = this;
  var logger = tree.getLogger();
  logger.debug('[%s] share.renameResource %s to %s', this.config.backend, oldName, newName);

  var url = this.buildResourceUrl(oldName);
  var options = this.applyRenameResourceRequestOptions(newName, this.applyRequestDefaults(tree, {
    url: url,
    method: 'MOVE',
    headers: {
    }
  }));
  options.headers[JCR.ACTION_HEADER] = JCR.ACTION_RENAME;
  webutils.submitRequest(options, function (err, resp, body) {
    if (err) {
      logger.error('failed to move %s to %s', oldName, newName, err);
      cb(SMBError.fromSystemError(err, 'unable to rename due to unexpected error'));
    } else if (resp.statusCode !== 201) {
      logger.error('failed to move %s to %s - %s %s [%d]', oldName, newName, options.method, options.href, resp.statusCode, body);
      cb(new SMBError(ntstatus.STATUS_UNSUCCESSFUL, 'unable to rename due to ' + resp.statusCode + ' status code'));
    } else {
      // succeeded
      // invalidate cache
      self.invalidateContentCache(tree, utils.getParentPath(oldName), true);
      self.invalidateContentCache(tree, utils.getParentPath(newName), true);
      cb();
    }
  });
};

JCRShare.prototype.invalidateContentCache = function (tree, path, deep) {
  var logger = tree.getLogger();
  if (this.cachedFileEntries[path]) {
    // file/directory entry
    //logger.debug('invalidating cached entry %s', path);
    delete this.cachedFileEntries[path];
    // invalidate parent folder listing as well
    var parentPath = utils.getParentPath(path);
    //logger.debug('invalidating cached directory listing %s', parentPath);
    delete this.cachedFolderListings[parentPath];
  }
  if (this.cachedFolderListings[path]) {
    // directory listing
    //logger.debug('invalidating cached directory listing %s', path);
    delete this.cachedFolderListings[path];
    // make sure child entries get invalidated as well
    deep = true;
  }

  var pathPrefix = path + Path.sep;

  function iterate(content, p, cache) {
    if (p.indexOf(pathPrefix) === 0) {
      //logger.debug('invalidating cached content %s', path);
      delete cache[p];
    }
  }

  if (deep) {
    _.forOwn(this.cachedFileEntries, iterate);
    _.forOwn(this.cachedFolderListings, iterate);
  }
};

/**
 * Retrieves metadata content about a file or directory.
 * @param {Tree} tree Will be used for logging.
 * @param {String} path Server path to a file or directory.
 * @param {Boolean} deep If true and the path is a directory, will retrieve metadata for child entities as well.
 * @param {Function} cb Invoked with the result of the operation.
 * @param {Error} cb.err Truthy if there were errors.
 * @param {Object} cb.content Metadata content for the path.
 */
JCRShare.prototype.fetchContent = function (tree, path, deep, cb) {
  this._fetchContent(tree, this.unicodeNormalize(path), deep, cb);
};

/**
 * Implementation of fetchContent. Should be overridden by child classes.
 */
JCRShare.prototype._fetchContent = function (tree, path, deep, cb) {
  if (path === Path.sep) {
    path = '';
  }
  var depth = deep ? 2 : 1;
  var url = this.buildContentUrl(path, depth);
  var action = JCR.ACTION_FOLDERLIST;
  if (!deep) {
    action = JCR.ACTION_INFO;
  }
  var options = this.applyRequestDefaults(tree, {headers: {}}, url);
  options.headers[JCR.ACTION_HEADER] = action;
  webutils.submitRequest(options, function (err, resp, body) {
    if (err) {
      cb(err);
    } else if (resp.statusCode === 200) {
      // succeeded
      try {
        cb(null, JSON.parse(body));
      } catch (parseError) {
        cb(parseError);
      }
    } else if (resp.statusCode === 404) {
      // not found, return null
      cb(null, null);
    } else {
      // failed
      cb(this.method + ' ' + this.href + ' [' + resp.statusCode + '] ' + body || '');
    }
  });
};

/**
 * Returns the path of local file holding a copy of the remote resource's content.
 *
 * @param {String} path path of remote resource
 * @param {Number} lastModified remote resource's last modification time stamp (used to detect stale cache entries)
 * @param {Function} cb callback called with the path of the local file holding a copy of the remote resource's content.
 * @param {String|Error} cb.error error (non-null if an error occurred)
 * @param {String} cb.localFilePath path of local file holding a copy of the remote resource's content.
 */
JCRShare.prototype.getLocalFile = function (tree, path, lastModified, cb) {
  var logger = tree.getLogger();
  var self = this;
  function checkCache(path, callback) {
    var result = self.cachedBinaries[path];
    if (result) {
      if (Date.now() - result.fetched <= self.binCacheTTL && lastModified <= result.lastModified) {
        // valid cache entry, verify
        fs.stat(result.localFilePath, function (err, stats) {
          if (err) {
            logger.warn('detected corrupt cache entry %s: local copy %s cannot be found', path, result.localFilePath, err);
            delete self.cachedBinaries[path];
            result = null;
          }
          callback(null, result);
        });
        return;
      } else {
        // evict expired cache entry
        delete self.cachedBinaries[path];
        fs.unlink(result.localFilePath, function (ignored) {});
        result = null;
        // fall through
      }
    }
    callback(null, result);
  }

  function cacheResource(path, callback) {
    logger.debug('fetching resource %s', path);
    self.fetchResource(tree.getContext(), path, function (err, localFilePath) {
      if (err) {
        cb(err);
        return;
      }
      // create cache entry
      if (localFilePath) {
        self.cachedBinaries[path] = {
          localFilePath: localFilePath,
          lastModified: lastModified,
          fetched: Date.now()
        };
        //logger.debug('cached resource %s', path);
      }
      callback(null, localFilePath);
    });
  }

  // check cache
  checkCache(path, function (err, result) {
    if (err) {
      cb(err);
    } else if (result) {
      // found valid cache entry. we're done
      cb(null, result.localFilePath);
    } else {
      // fetch resource and cache it
      cacheResource(path, cb);
    }
  });
};

/**
 * Touches the cache entry of a remote resource, i.e. extends the entry's TTL and updates the lastModified timestamp.
 * The cached local file itself won't be touched or modified.
 *
 * @param {String} path path of remote resource
 * @param {Number} lastModified remote resource's last modification time stamp (used to detect stale cache entries)
 * @param {Function} cb callback called with the path of the local file holding a copy of the remote resource's content.
 * @param {String|Error} cb.error error (non-null if an error occurred)
 */
JCRShare.prototype.touchLocalFile = function (tree, path, lastModified, cb) {
  var logger = tree.getLogger();
  var result = this.cachedBinaries[path];
  if (result) {
    fs.stat(result.localFilePath, function (err, stats) {
      if (!err) {
        result.lastModified = lastModified;
        result.fetched = Date.now();
        cb();
      } else {
        logger.warn('detected corrupt cache entry %s: local copy %s cannot be found', err);
        delete self.cachedBinaries[path];
        cb(err);
      }
    });
  }
};

/**
 * Removes the cache entry and discards the local file holding a copy of the remote resource's content.
 *
 * @param {String} path path of remote resource
 * @param {Function} cb callback called on completion
 * @param {String|Error} cb.error error (non-null if an error occurred)
 */
JCRShare.prototype.discardLocalFile = function (path, cb) {
  var result = this.cachedBinaries[path];
  if (result) {
    delete this.cachedBinaries[path];
    fs.unlink(result.localFilePath, cb);
  } else {
    cb();
  }
};

/**
 * Determines if the specified remote resource exists.
 * @param {Tree} tree SPI tree whose logger will be used.
 * @param {String} name Path to check for existence.
 * @param {Function} cb Will be invoked with the result.
 * @param {Error} cb.err Will be truthy if an error occurred.
 * @param {Boolean} cb.exists Truthy if the resource exists, false otherwise.
 */
JCRShare.prototype.resourceExists = function (tree, name, cb) {
  this._resourceExists(tree, this.unicodeNormalize(name), cb);
};

/**
 * Implementation of resourceExists. Should be overridden by child classes.
 */
JCRShare.prototype._resourceExists = function (tree, name, cb) {
  var logger = tree.getLogger();

  // there is a bug in the assets api when doing a HEAD request for a folder that
  // doesn't exist. we end up in a redirect loop. instruct the request not to follow redirects and assume
  // that a redirect means that the url does not exist. in addition, use the content url instead of
  // the resource url due to sometimes receiving 302s even for folders that exist. using the content url
  // correctly returns a 200 for these folders
  var url = this.buildContentUrl(name);
  var options = this.applyRequestDefaults(tree, {
    url: url,
    method: 'HEAD',
    followRedirect: false,
    headers: {}
  });
  options.headers[JCR.ACTION_HEADER] = JCR.ACTION_EXISTS;

  webutils.submitRequest(options, function (err, resp) {
    if (err) {
      // failed
      logger.error('failed to determine existence of %s', name, err);
      cb(SMBError.fromSystemError(err, 'unable to determine existence due to unexpected error'));
    } else {
      cb(null, resp.statusCode === 200);
    }
  });
};

/**
 * Fetches the specified remote resource and returns the path of the local file holding a copy of the remote resource's content.
 *
 * @param {String} path path of remote resource
 * @param {Function} cb callback called with the path of the local file holding a copy of the remote resource's content.
 * @param {String|Error} cb.error error (non-null if an error occurred)
 * @param {String} cb.localFilePath path of local file holding a copy of the remote resource's content.
 */
JCRShare.prototype.fetchResource = function (context, path, cb) {
  this._fetchResource(context, this.unicodeNormalize(path), cb);
};

/**
 * Implementation of fetchResource. Should be overridden by child classes.
 */
JCRShare.prototype._fetchResource = function (context, path, cb) {
  var logger = context.spi();
  // spool remote resource to local tmp file
  var stream = this.createResourceStream(path);
  var tmpFilePath = stream.path;

  var self = this;

  var failed = false;
  stream.on('finish', function () {
    if (failed) {
      fs.unlink(tmpFilePath, function (ignored) {
        cb('failed to spool ' + path + ' to ' + tmpFilePath);
      });
    } else {
      fs.stat(tmpFilePath, function (err, stats) {
        if (err) {
          cb(err);
        } else {
          logger.debug('[%s] spooled %s to %s (%d bytes)', self.config.backend, path, tmpFilePath, stats.size);
          if (stats.size == 0) {
            logger.warn('downloaded 0 byte file %s. verify remote size', path);
          }
          cb(null, tmpFilePath);
        }
      });
    }
  });

  stream.on('error', function (err) {
    fs.unlink(tmpFilePath, function (ignored) {
      cb(err);
    });
  });

  var url = this.buildResourceUrl(path);
  var options = this.applyRequestDefaults(context, {headers:{}}, url);
  options.headers[JCR.ACTION_HEADER] = JCR.ACTION_DOWNLOADFILE;
  self.emitShareEvent('downloadstart', {path: path});
  var req = webutils.submitRequest(options)
    .on('response', function (resp) {
      if (resp.statusCode !== 200) {
        logger.error('failed to spool %s to %s - %s %s [%d]', path, tmpFilePath, this.method, this.href, resp.statusCode);
        self.emitShareEvent('downloaderr', {path: path, err: 'unexpected status code: ' + resp.statusCode});
        failed = true;
      }
      var totalSize = 0;

      if (resp.headers) {
        // content length is not always provided
        if (resp.headers['content-length']) {
          totalSize = resp.headers['content-length'];
        }
      }

      webutils.monitorTransferProgress(resp, path, totalSize, function (progress) {
        logger.debug('received download progress for %s', path, progress);

        // only send long download event once every 30 seconds
        var now = new Date().getTime();
        if (progress.elapsed > 3000 && (now - self.lastLongDownload > 30000)) {
          self.lastLongDownload = now;
          logger.info('long download of %s detected, sending event', path);
          self.emitShareEvent('longdownload', {path: path});
        }

        self.emitShareEvent('downloadprogress', progress);
      });
    })
    .on('end', function () {
      self.unregisterDownloadRequest(path);
      self.emitShareEvent('downloadend', {path: path});
    })
    .on('error', function (err) {
      self.unregisterDownloadRequest(path);
      self.emitShareEvent('downloaderr', {path: path, err: (err.message || err)});
      fs.unlink(tmpFilePath, function (ignored) {
        cb(err);
      });
    })
  self.registerDownloadRequest(path, req);
  req.on('abort', function () {
    logger.info('download of path %s was aborted', path);
    self.unregisterDownloadRequest(path);
    self.emitShareEvent('downloadabort', {path: path});
    fs.unlink(tmpFilePath, function (ignored) {
      cb('download of path %s was aborted', path);
    });
  });
  req.pipe(stream);
};

JCRShare.prototype.createResourceStream = function (path) {
  return this.temp().createWriteStream({
    suffix: '-' + utils.getPathName(path)
  });
};

JCRShare.prototype.createTreeInstance = function (content, tempFilesTree) {
  return new JCRTreeConnection(this, content, tempFilesTree);
};

JCRShare.prototype.applyRequestDefaults = function (tree, opts, url) {
  var def = {emitter: this};
  if (tree) {
    // could be a Tree instance or an SMBContext. Handle both
    if (tree.getContext) {
      def['logger'] = tree.getRequestLogger();
    } else {
      def['logger'] = tree;
    }
  }
  if (url) {
    def.url = url;
  }
  if (this.auth) {
    def.auth = this.auth;
  }
  // limit/throttle # of concurrent backend requests
  def.pool = { maxSockets: this.maxSockets };
  if (this.config.strictSSL !== undefined) {
    def.strictSSL = this.config.strictSSL;
  }
  return _.defaultsDeep(def, opts, this.config.options);
};

//--------------------------------------------------------------------< Share >

/**
 * Return a flag indicating whether this is a named pipe share.
 *
 * @return {Boolean} <code>true</code> if this is a named pipe share;
 *         <code>false</code> otherwise, i.e. if it is a disk share.
 */
JCRShare.prototype.isNamedPipe = function () {
  return false;
};

/**
 *
 * @param {Session} session
 * @param {Buffer|String} shareLevelPassword optional share-level password (may be null)
 * @param {Function} cb callback called with the connect tree
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {JCRTree} cb.tree connected tree
 */
JCRShare.prototype.connect = function (session, shareLevelPassword, cb) {
  var logger = wlogger;
  var self = this;
  this.purgeCacheTimer = setInterval(function () {
    var now = Date.now();
    function iterate(content, path, cache) {
      if (now - content.fetched > self.contentCacheTTL) {
        delete cache[path];
      }
    }
    _.forOwn(self.cachedFileEntries, iterate);
    _.forOwn(self.cachedFolderListings, iterate);
  }, this.contentCacheTTL);

  function getContent(done) {
    self.getContent(null, Path.sep, false, done);
  }

  function createTempDir(content, done) {
    if (!content) {
      done('not found');
      return;
    }
    if (!self.config.tmpPath) {
        self.temp().mkdir('NodeSMBServerTmpFiles_', function (err, dirPath) {
            if (!err) {
                logger.debug('created local tmp directory for temporary system files: %s', dirPath);
            }
            done(err, content, dirPath);
        });
    } else {
      mkdirp(self.config.tmpPath, function (err) {
        if (!err) {
          logger.debug('created local tmp directory for temporary system files: %s', self.config.tmpPath);
        }
        done(err, content, self.config.tmpPath);
      });
    }
  }

  function prepopulateTempDir(content, tempDir, done) {
    fs.closeSync(fs.openSync(Path.join(tempDir, '.metadata_never_index'), 'w'));
    fs.closeSync(fs.openSync(Path.join(tempDir, '.metadata_never_index_unless_rootfs'), 'w'));
    //fs.closeSync(fs.openSync(Path.join(tempDir, '.com.apple.smb.streams.off'), 'w'));
    done(null, content, tempDir);
  }

  function connectTempTree(content, tempDir, done) {
    var tmpShare = new FSShare('tmpFiles', {
      backend: 'fs',
      description: 'shadow share for local temporary system files',
      path: tempDir,
      unicodeNormalizeForm: self.config.unicodeNormalizeForm
    });

    tmpShare.connect(session, null, function (error, tmpTree) {
      done(error, content, tmpTree);
    });
  }

  function connectJCRTree(content, tempTree, done) {
    done(null, self.createTreeInstance(content, tempTree));
  }

  async.waterfall([ getContent, createTempDir, prepopulateTempDir, connectTempTree, connectJCRTree ], function (err, tree) {
    if (err) {
      var msg = 'invalid share configuration: ' + JSON.stringify({ host: self.config.host, port: self.config.port, path: self.config.path });
      logger.error(msg, err);
      cb(SMBError.fromSystemError(err, msg));
    } else {
      cb(null, tree);
    }
  });
};

JCRShare.prototype.disconnect = function (cb) {
  clearInterval(this.purgeCacheTimer);
  this.cancelAllTransfers();
  this.temp().cleanup(cb);
};

module.exports = JCRShare;

