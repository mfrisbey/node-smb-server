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

var Util = require('util');
var async = require('async');

var utils = require('../../utils');
var webutils = require('../../webutils');
var JCRShare = require('../jcr/share');
var DAMTreeConnection = require('./treeconnection');
var JCR = require('../jcr/constants');
var DAM = require('./constants');
var Path = require('path');
var log = require('../../logging').getLogger('spi');
var ntstatus = require('../../ntstatus');
var SMBError = require('../../smberror');
var fs = require('fs');

/**
 * Creates an instance of JCRShare.
 *
 * @constructor
 * @this {DAMShare}
 * @param {String} name share name
 * @param {Object} config configuration hash
 */
var DAMShare = function (name, config) {
  if (!(this instanceof DAMShare)) {
    return new DAMShare(name, config);
  }

  this.contextPath = '';

  config = config || {};
  if (!config.path) {
    config.path = DAM.DAM_ROOT_PATH;
  } else {
    // check for context path
    if (config.path.indexOf(DAM.DAM_ROOT_PATH) > 0) {
      this.contextPath = config.path.substr(0, config.path.indexOf(DAM.DAM_ROOT_PATH));
    }
  }
  JCRShare.call(this, name, config);
};

// the DAMShare prototype inherits from JCRShare
Util.inherits(DAMShare, JCRShare);

DAMShare.prototype.isAssetClass = function (entity) {
  var cls = (entity && entity[DAM.CLASS]) || [];
  return cls.indexOf(DAM.CLASS_ASSET) > -1;
};

DAMShare.prototype.isFolderClass = function (entity) {
  var cls = (entity && entity[DAM.CLASS]) || [];
  return cls.indexOf(DAM.CLASS_FOLDER) > -1;
};

//-----------------------------------------------------------------< JCRShare >

DAMShare.prototype.getContent = function (tree, path, deep, forceCacheRefresh, cb) {
  // support previous versions of the function that did not have forceRefresh parameter
  if (typeof forceCacheRefresh === 'function') {
    cb = forceCacheRefresh;
    forceCacheRefresh = false;
  }

  var self = this;
  if (deep) {
    // for folder lists, use default implementation
    JCRShare.prototype.getContent.call(self, tree, path, deep, forceCacheRefresh, cb);
  } else {
    // for individual entities, retrieve the parent's folder list and use the entity information from there.
    // this is to avoid the need to make an extra HTTP request when retrieving information about individual items
    var parent = utils.getParentPath(path);
    var name = utils.getPathName(path);
    self.getContent(tree, parent, true, forceCacheRefresh, function (err, parentContent) {
      if (err) {
        cb(err);
      } else {
        if (parent == path) {
          // it's the root path
          cb(null, parentContent);
        } else if (parentContent) {
          // find the entity in the parent's list of entities
          var entities = parentContent[DAM.ENTITIES];
          if (!entities) {
            // no entities found, return null
            cb(null, null);
          } else {
            var i;
            var entityContent = null;
            for (i = 0; i < entities.length; i++) {
              if (entities[i][DAM.PROPERTIES]) {
                var currName = entities[i][DAM.PROPERTIES][DAM.NAME];
                if (self.unicodeEquals(currName, name)) {
                  entityContent = entities[i];
                  break;
                }
              }
            }
            cb(null, entityContent);
          }
        } else {
          // no parent content found, return null
          cb(null, null);
        }
      }
    });
  }
};

DAMShare.prototype.parseContentChildEntries = function (content, iterator) {
  var self = this;
  var entities = content[DAM.ENTITIES] || [];
  entities.forEach(function (entity) {
    var nm = entity[DAM.PROPERTIES] && entity[DAM.PROPERTIES][DAM.NAME];
    if (nm) {
      if (self.isAssetClass(entity) || self.isFolderClass(entity)) {
        iterator(nm, entity);
      }
    }
  });
};

DAMShare.prototype.buildUrlRoot = function () {
  return this.protocol + '//' + this.host + ':' + this.port + this.contextPath;
};

DAMShare.prototype.buildContentUrl = function (path, depth) {
  return this.buildUrlRoot(path) + DAM.ASSETS_API_PATH + encodeURI(utils.normalizeSMBFileName(utils.stripParentPath(this.path, this.contextPath + DAM.DAM_ROOT_PATH) + path)) + '.json';
};

DAMShare.prototype.buildResourceUrl = function (path) {
  return this.buildUrlRoot(path) + this.buildResourcePath(path);
};

DAMShare.prototype.buildResourcePath = function (path) {
  return DAM.ASSETS_API_PATH + encodeURI(utils.normalizeSMBFileName(utils.stripParentPath(this.path, this.contextPath + DAM.DAM_ROOT_PATH) + path));
};

DAMShare.prototype.buildContentDamUrl = function (path) {
  return this.buildUrlRoot() + encodeURI(this.buildContentDamPath(path));
};

DAMShare.prototype.buildContentDamPath = function (path) {
  return DAM.DAM_ROOT_PATH + utils.normalizeSMBFileName(utils.stripParentPath(this.path, this.contextPath + DAM.DAM_ROOT_PATH) + path);
};

DAMShare.prototype.buildCreateAssetPath = function (path) {
  var assetPath = this.buildContentDamUrl(path);
  if (assetPath.charAt(assetPath.length - 1) == '/') {
    assetPath = assetPath.substr(0, assetPath.length - 1);
  }
  return assetPath + '.createasset.html';
};

DAMShare.prototype.buildWcmCommandUrl = function () {
  return this.buildUrlRoot() + '/bin/wcmcommand';
};

DAMShare.prototype._fetchContent = function (tree, path, deep, cb) {
  var logger = log;
  if (tree) {
    log = tree.getLogger();
  }
  var self = this;
  if (path === Path.sep) {
    path = '';
  }
  var action = JCR.ACTION_FOLDERLIST;
  if (!deep) {
    action = JCR.ACTION_INFO;
  }
  var options = {headers: {}};
  options.headers[JCR.ACTION_HEADER] = action;
  var url = this.buildContentUrl(path, deep ? 1 : 0)
      + '?limit=9999&showProperty=jcr:created&showProperty=jcr:lastModified&showProperty=asset:size&showProperty=asset:readonly&showProperty=cq:drivelock';
  var opts = this.applyRequestDefaults(tree, options, url);
  webutils.submitRequest(opts, function (err, resp, body) {
    if (err) {
      cb(err);
    } else if (resp.statusCode === 200) {
      // succeeded
      var parsed;
      try {
        parsed = JSON.parse(body);
      } catch (parseError) {
        // unexpected format, return null
        logger.error('unexpected JSON format from api', parseError);
        cb(null, null);
        return;
      }
      cb(null, parsed);
    } else if (resp.statusCode === 404) {
      // not found, return null
      cb(null, null);
    } else {
      // failed
      cb(self.method + ' ' + self.href + ' [' + resp.statusCode + '] ' + body || '');
    }
  });
};

DAMShare.prototype.createTreeInstance = function (content, tempFilesTree) {
  return new DAMTreeConnection(this, content, tempFilesTree);
};

DAMShare.prototype.applyCreateFileResourceRequestOptions = function (options) {
  options['method'] = 'POST';
  return options;
};

DAMShare.prototype.applyCreateDirectoryResourceRequestOptions = function (options) {
  options['method'] = 'POST';
  options['headers'] = options.headers || {};
  options.headers['Content-Type'] = 'application/json; charset=utf-8'
  return options;
};

function _getJcrTitleProperties(title) {
  var props = {
    properties: {}
  };
  props.properties[JCR.JCR_TITLE] = title;
  return JSON.stringify(props);
};

DAMShare.prototype._createDirectoryResource = function (tree, path, cb) {
  var req = JCRShare.prototype._createDirectoryResource.call(this, tree, path, cb);

  // make sure jcr title is set in DAM
  var pathName = utils.getPathName(path);
  var props = {
    properties: {}
  };
  props.properties[JCR.JCR_TITLE] = pathName;
  req.write(_getJcrTitleProperties(pathName));
  return req;
};

DAMShare.prototype.applyRenameResourceRequestOptions = function (newName, options) {
  options['headers'] = options.headers || {};
  options.headers['X-Destination'] = this.buildResourcePath(newName);
  options.headers['X-Depth'] = 'infinity';
  options.headers['X-Overwrite'] = 'F';
  return options;
};

/**
 * Sends an update request that will change the given path's jcr:title to match the path.
 * @param {Tree} tree Will be used for logging.
 * @param {String} path The path to be updated. The new title will be extracted from the path.
 * @param {Function} cb Will be invoked when the update is complete.
 */
function _updateTitle(tree, path, cb) {
  var logger = tree.getLogger();
  var url = this.buildResourceUrl(path);
  var newTitle = utils.getPathName(path);
  var options = this.applyRequestDefaults(tree, {
    url: url,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
  options.headers[JCR.ACTION_HEADER] = JCR.ACTION_UPDATETITLE;
  var req = webutils.submitRequest(options, function (err, resp, body) {
    if (err) {
      logger.error('failed to update title for %s', path, err);
    } else if (resp.statusCode !== 200) {
      logger.error('failed to update title for %s - %s %s [%d]', path, options.method, options.url, resp.statusCode, body);
    }
    cb();
  });
  req.write(_getJcrTitleProperties(newTitle));
  req.end();
}

DAMShare.prototype._renameResource = function (tree, oldName, newName, cb) {
  var self = this;
  JCRShare.prototype._renameResource.call(this, tree, oldName, newName, function (err) {
    if (err) {
      cb(err);
      return;
    }
    _updateTitle.call(self, tree, newName, cb);
  });
};

function _uploadChunk(
  tree,
  requestOptions,
  remotePath,
  localPath,
  chunkOffset,
  totalSize,
  chunkSizeFixed,
  replace,
  localEventPath,
  callback) {
  if (chunkOffset > 0) {
    // only include custom chunk info on first chunk request
    delete requestOptions.headers['x-chunked-content-type'];
    delete requestOptions.headers['x-chunked-total-size'];
  }
  var logger = tree.getLogger();
  var self = this;
  var req = webutils.submitRequest(requestOptions, function (err, resp) {
    self.unregisterUploadRequest(remotePath);
    if (err) {
      logger.error('error attempting to upload chunk', err);
      callback(SMBError.fromSystemError(err, 'unexpected error in request while uploading'));
    } else if (resp.statusCode == 423) {
      logger.debug('path [%s] received locked status, indicating file is checked out', remotePath);
      callback(new SMBError(ntstatus.STATUS_ACCESS_DENIED, 'Asset is checked out by another user'));
    } else if (resp.statusCode != 200 && resp.statusCode != 201) {
      logger.debug('received response with invalid status code %d', resp.statusCode);
      callback(new SMBError(ntstatus.STATUS_UNSUCCESSFUL, 'unexpected status code: ' + resp.statusCode));
    } else {
      logger.debug('path [%s] chunk completed', remotePath);
      callback(null, chunkSize);
    }
  });
  self.registerUploadRequest(remotePath, req);
  req.on('abort', function () {
    logger.info('upload of path %s was aborted', remotePath);
    var error = new SMBError(ntstatus.STATUS_UNSUCCESSFUL, 'upload was aborted');
    callback({error: error, ignoreEmit: true});
  });
  var form = req.form();
  form.append('_charset_', 'utf-8');
  if(replace) {
    logger.debug('Updating the file %s, Use post for CreateAssetServelet', remotePath);
    form.append('replaceAsset','true');
  }
  var chunkSize = chunkOffset + chunkSizeFixed < totalSize ? chunkSizeFixed : totalSize - chunkOffset;
  logger.debug('Uploading chunks to the file %s of size %s Chunk curent offset %s chunksize %s', remotePath, totalSize, chunkOffset, chunkSize);
  var read = fs.createReadStream(localPath, {'start':chunkOffset, 'end':chunkSize+chunkOffset-1});
  read.on('error', function (err) {
    self.unregisterUploadRequest(remotePath);
    logger.error('unexpected error reading path %s', err);
    callback(SMBError.fromSystemError(err), 'unexpected error reading file to upload');
  });
  /* if filesize is less than the chunk, upload file at once*/
  if(chunkSizeFixed < totalSize) {
    form.append('file@Offset', chunkOffset);
  }
  form.append('chunk@Length', chunkSize);
  form.append('file@Length', totalSize);
  if(chunkOffset >= totalSize) {
    form.append('file@Completed', 'true');
  }
  form.append('file', read, {
    filename: self.unicodeNormalize(localPath) // explicitely set the path because the stream's path is not guaranteed to have the correct encoding
  });
  webutils.monitorTransferProgress(read, remotePath, totalSize, localEventPath, function (progress) {
    /* Add the chunk offset, thats what is already uploaded*/
    progress.read = progress.read + chunkOffset - chunkSize;
    logger.debug('%s: read %d of %d bytes, upload %d percent complete, rate of %d bytes/sec', remotePath, progress.read, totalSize, Math.round(progress.read / totalSize * 100), progress.rate);
    self.emitSyncFileProgress(progress);
  });
}

function _doChunkUpload(tree, remotePath, localPath, replace, chunkOptions, cb) {
  var logger = tree.getLogger();
  var self = this;
  var method = replace ? 'PUT' : 'POST'; // used for sync event data only
  chunkOptions = chunkOptions || {};
  remotePath = self.unicodeNormalize(remotePath);

  var localEventPath = null;
  if (chunkOptions.includeLocalPath) {
    localEventPath = localPath;
    logger.debug('using local event path %s for share events', localEventPath);
  }

  function _isReadOnly(callback) {
    if (replace) {
      self.isReadOnly(tree, remotePath, function (err, checkedOut) {
        if (err) {
          _completeUpload(err);
        } else if (checkedOut) {
          logger.info('path %s is checked out by another user. unable to update', remotePath);
          _completeUpload(new SMBError(ntstatus.STATUS_ACCESS_DENIED, 'Asset is checked out by another user'));
        } else {
          callback();
        }
      });
    } else {
      callback();
    }
  }

  function _completeUpload(err) {
    logger.debug('entering _completeUpload for file %s', remotePath);
    if (err) {
      var doEmit = true;
      if (err.error) {
        doEmit = !(err.ignoreEmit);
        err = err.error;
      }
      if (doEmit) {
        logger.info('encountered handled error while attempting to sync file %s', remotePath, err);
        self.emitSyncFileError(remotePath, method, err, localEventPath);
      }
      cb(err);
    } else {
      logger.info('finished sync of file %s', remotePath);
      self.invalidateContentCache(tree, utils.getParentPath(remotePath), true);
      self.emitSyncFileEnd(remotePath, method, localEventPath);
      cb();
    }
  }

  _isReadOnly(function () {
    logger.info('beginning sync of file %s', remotePath);

    fs.stat(localPath, function (err, stats) {
      if (err) {
        cb(SMBError.fromSystemError(err, 'unable to stat file ' + localPath));
        return;
      }
      self.emitSyncFileStart(remotePath, method, localEventPath);

      var chunkSizeFixed = self.config.chunkUploadSize;
      if (!chunkSizeFixed) {
        chunkSizeFixed = 10; // default to 10 MB
      }
      chunkSizeFixed *= (1024 * 1024);
      var totalSize = stats.size;
      var chunkOffset = chunkOptions.fromOffset || 0;
      var continueUpload = true;
      var retries = 0;
      var maxRetries = self.config.maxRetries || 3;
      var retryDelay = self.config.retryDelay || 3000;
      var currDelay = 0;

      var options = self.applyRequestDefaults(tree, {
        url: self.buildCreateAssetPath(utils.getParentPath(remotePath)),
        method: 'POST',
        headers: {
          'content-type': 'multipart/form-data',
          'x-chunked-content-type': utils.lookupMimeType(remotePath),
          'x-chunked-total-size': totalSize
        }
      });
      options.headers[JCR.ACTION_HEADER] = JCR.ACTION_CREATEFILE;

      async.whilst(function () { return chunkOffset < totalSize && continueUpload; }, function (whileCb) {
        setTimeout(function () {
          _uploadChunk.call(self, tree, options, remotePath, localPath, chunkOffset, totalSize, chunkSizeFixed, replace, localEventPath, function (err, chunkSize) {
            var currChunk = chunkOffset;
            if (!err) {
              chunkOffset += chunkSize;
              retries = 0;
              currDelay = 0;
            } else if (err.error) {
              logger.debug('chunk failed due to abort. not retrying', remotePath);
              retries = maxRetries;
            } else {
              // the chunk failed. delay for the configured amount of time and retry again, up to maxRetries
              retries++;
              currDelay = retryDelay;
              logger.error('encountered error uploading chunk. current retry count is %s. delay will be %s', retries, currDelay, err);
            }
            if (retries >= maxRetries) {
              whileCb(err);
              return;
            }
            if (chunkOptions.onChunk) {
              logger.debug('calling provided onChunk callback for %s', remotePath);
              chunkOptions.onChunk(chunkOffset, totalSize, function (cancel) {
                logger.debug('received onChunk response for %s', remotePath);
                continueUpload = !cancel;
                whileCb();
              });
            } else {
              log.debug('finished chunk %s, moving on to next chunk %s for %s', currChunk, chunkOffset, remotePath);
              whileCb();
            }
          });
        }, currDelay);
      }, _completeUpload);
    });
  });
}

function checkDotFile(tree, path, method, localPath, options, cb) {
  var logger = tree.getLogger();
  if (path.match(/\/\./g)) {
    logger.warn('%s: attempt to %s path containing names beginning with a period', path, method);
    this.emitSyncFileError(path, method, 'files containing names beginning with a period are forbidden: ' + path, options.includeLocalPath ? localPath : null);
    cb(new SMBError(ntstatus.STATUS_NOT_SUPPORTED, 'files containing names beginning with a period are forbidden'));
    return true;
  }
  return false;
}

DAMShare.prototype._updateResource = function (tree, remotePath, localPath, cb) {
  if (!checkDotFile.call(this, tree, remotePath, 'PUT', localPath, {}, cb)) {
    if (localPath) {
      _doChunkUpload.call(this, tree, remotePath, localPath, true, {}, cb);
    } else {
      JCRShare.prototype._updateResource.call(this, tree, remotePath, localPath, cb);
    }
  }
};

/**
 * Creates a file resource on the remote server by uploading a local file.
 * @param {Tree} tree Will be used for logging messages.
 * @param {String} remotePath The server path of a resource.
 * @param {String} localPath Full path to a local file.
 * @param [Object] options Optional settings to control the creation process.
 * @param [Number] options.fromOffset If specified, the chunked upload process will begin from this 0-based offset in the file.
 * @param [Function] options.onChunk If specified, will be invoked each time the upload process finishes uploading a
 *   chunk. Will be called with parameters: nextOffset (0-based index of the byte offset where the next chunk will begin),
 *   totalSize (total size (in bytes) of the file to upload), chunkCallback (should be invoked when handling is
 *   complete. Expects one parameter, which, if true, indicates that no more chunks should be uploaded).
 * @param {Function} cb Invoked when the operation is complete.
 * @param {Error} cb.err Truthy if there were errors.
 */
DAMShare.prototype._createFileResource = function (tree, remotePath, localPath, options, cb) {
  if (typeof options === 'function') {
    cb = options;
    options = {};
  }

  if (!checkDotFile.call(this, tree, remotePath, 'POST', localPath, options, cb)) {
    if (localPath) {
      _doChunkUpload.call(this, tree, remotePath, localPath, false, options, cb);
    } else {
      JCRShare.prototype._createFileResource.call(this, tree, remotePath, localPath, options, cb);
    }
  }
};

DAMShare.prototype._deleteResource = function (tree, path, isFile, cb) {
  var self = this;
  var logger = tree.getLogger();

  function isReadOnly(callback) {
    if (isFile) {
      self.isReadOnly(tree, path, function (err, checkedOut) {
        if (err) {
          callback(err);
        } else {
          callback(null, checkedOut);
        }
      });
    } else {
      callback(null, false);
    }
  }

  function sendCallback(err) {
    if (err) {
      if (isFile) {
        self.emitSyncFileError(path, 'DELETE', err);
      }
      cb(err);
      return;
    } else if (isFile) {
      self.emitSyncFileEnd(path, 'DELETE');
    }
    cb();
  }

  if (!checkDotFile.call(this, tree, path, 'DELETE', null, {}, cb)) {
    isReadOnly(function (err, isReadOnly) {
      if (err) {
        sendCallback(SMBError.fromSystemError(err, 'unable to determine checked out status of path'));
        return;
      } else if (isReadOnly) {
        sendCallback(new SMBError(ntstatus.STATUS_ACCESS_DENIED, 'cannot delete file because it is checked out'));
        return;
      }
      var options = self.applyRequestDefaults(tree, {
        url: self.buildWcmCommandUrl(),
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        }
      });
      options.headers[JCR.ACTION_HEADER] = JCR.ACTION_DELETE;

      if (isFile) {
        self.emitSyncFileStart(path, 'DELETE');
      }

      var req = webutils.submitRequest(options, function (err, res, body) {
        if (err) {
          logger.error('failed to delete %s', path, err);
          sendCallback(SMBError.fromSystemError(err, 'unable to delete file due to unexpected error'));
        } else if (res.statusCode != 200) {
          sendCallback(new SMBError(ntstatus.STATUS_UNSUCCESSFUL, 'cannot delete file due to ' + res.statusCode + ' response code'));
        } else {
          // succeeded
          // invalidate cache
          self.invalidateContentCache(tree, path, false);
          sendCallback();
        }
      });

      var form = req.form();
      form.append('path', self.buildContentDamPath(path));
      form.append('cmd', 'deletePage');
      form.append('force', 'true');
      form.append('_charset_', 'utf-8');
    });
  }
};

/**
 * Determines if a path has been checked out by another user or not.
 * @param {Tree} tree Will be used for logging.
 * @param {String} path Server path of a file.
 * @param {Function} cb Invoked with the result of the operation.
 * @param {Error} cb.err Truthy if there was an error.
 * @param {Boolean} cb.checkedOut True if the path is checked out, false otherwise.
 */
DAMShare.prototype.isReadOnly = function (tree, path, cb) {
  this.getContent(tree, path, false, true, function (err, content) {
    if (err) {
      cb(err);
      return;
    }

    if (!content) {
      cb(null, false);
      return;
    }

    var readOnly = false;
    if (content[DAM.PROPERTIES]) {
      if (content[DAM.PROPERTIES][DAM.ASSET_READONLY]) {
        readOnly = true;
      }
    }
    cb(null, readOnly);
  });
};

//--------------------------------------------------------------------< Share >

/**
 * Return a flag indicating whether this is a named pipe share.
 *
 * @return {Boolean} <code>true</code> if this is a named pipe share;
 *         <code>false</code> otherwise, i.e. if it is a disk share.
 */
DAMShare.prototype.isNamedPipe = function () {
  // call base class method
  return JCRShare.prototype.isNamedPipe.call(this);
};

/**
 *
 * @param {Session} session
 * @param {Buffer|String} shareLevelPassword optional share-level password (may be null)
 * @param {Function} cb callback called with the connect tree
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {TreeConnection} cb.tree connected tree
 */
DAMShare.prototype.connect = function (session, shareLevelPassword, cb) {
  // call base class method
  return JCRShare.prototype.connect.call(this, session, shareLevelPassword, cb);
};

module.exports = DAMShare;
