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
var logger = require('winston').loggers.get('spi');

var Share = require('../../spi/share');
var RQTree = require('./tree');
var RQRemoteShare = require('./remoteshare');
var RequestQueue = require('./requestqueue');
var RQProcessor = require('./rqprocessor');

/**
 * Creates an instance of RQShare.
 *
 * @constructor
 * @this {RQShare}
 * @param {String} name share name
 * @param {Object} config configuration hash
 */
var RQShare = function (name, config, remote) {
  if (!(this instanceof RQShare)) {
    return new RQShare(name, config, remote);
  }
  var self = this;
  this.config = config || {};
  this.listCache = {};
  this.contentCacheTTL = typeof config.contentCacheTTL === 'number' ? config.contentCacheTTL : 30000; // default: 30s
  this.waits = {};
  this.downloadingFiles = {};
  this.remote = remote;
  if (!this.remote) {
    this.remote = new RQRemoteShare(name, config);
  }
  this.remote.on('folderlist', function (files) {
    self.emit('folderlist', files);
  });

  this.rq = new RequestQueue({
    path: config.work.path
  });
  this.emit('requestqueueinit', this.rq);
  this.processor = new RQProcessor(this, config);

  this.processor.on('syncstart', function (data) {
    logger.info('start sync %s %s', data.method, data.file);
    self.emit('syncfilestart', data);
  });

  this.processor.on('syncend', function (data) {
    logger.info('end sync %s %s', data.method, data.file);
    self.emit('syncfileend', data);
  });

  this.processor.on('syncerr', function (data) {
    logger.error('err sync %s %s', data.method, data.file, data.err);
    self.emit('syncfileerr', data);
  });

  this.processor.on('error', function (err) {
    logger.error('there was a general error in the processor', err);
    self.emit('syncerr', {err: err});
  });

  this.processor.on('purged', function (purged) {
    logger.info('failed files were purged from the queue', purged);
    self.emit('syncpurged', {files: purged});
  });

  this.processor.on('syncabort', function (data) {
    logger.info('abort sync %s', data.file);
    self.emit('syncfileabort', data);
  });

  this.processor.on('syncprogress', function (data) {
    logger.debug('sync progress %s', data.path);
    self.emit('syncfileprogress', data);
  });

  if (!config.noprocessor) {
    this.processor.start(config);
  }

  Share.call(this, name, config);
};

// the RQShare prototype inherits from Share
util.inherits(RQShare, Share);

RQShare.prototype.notifyDownloadComplete = function (tree, path) {
  var logger = tree.getLogger();
  var self = this;
  if (self.waits[path]) {
    var i;
    for (i = 0; i < self.waits[path].length; i++) {
      // invoke waiting callback
      var waitCallback = self.waits[path][i].callback;
      var waitTree = self.waits[path][i].tree;

      logger.info('%s download complete, notifying waiting thread %s', path, tree.getRequestId());
      tree.getLogger().info('%s download complete, wait callback invoked', path);
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

RQShare.prototype.invalidateContentCache = function (context, path, deep) {
  var rqlog = context.rq();
  rqlog.debug('RQShare.invalidateContentCache %s', path);
  if (this.remote.invalidateContentCache) {
    this.remote.invalidateContentCache(context, path, deep);
  }
  this.listCache[path] = undefined;
};

RQShare.prototype.getListCache = function (context, path, tree, cb) {
  var rqlog = context.rq();
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

RQShare.prototype.applyRequestDefaults = function(context, opts, url) {
  return this.remote.applyRequestDefaults(context, opts, url);
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
      cb(null);
    }
  });
};

RQShare.prototype.createTree = function (context) {
  return new RQTree(this, this.remote.createTree(context), this.config, context);
};

/**
 * Disconnects the share and stops the RQ processor.
 */
RQShare.prototype.disconnect = function (cb) {
  if (!this.config.noprocessor) {
    this.processor.stop();
  }
  cb();
};

module.exports = RQShare;
