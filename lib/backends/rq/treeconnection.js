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

var TreeConnection = require('../../spi/treeconnection');
var RQTree = require('./tree');
var RequestQueue = require('./requestqueue');
var RQProcessor = require('./rqprocessor');
var FSTreeConnection = require('../fs/treeconnection');
var FSShare = require('../fs/share');

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

  this.options = options;
  this.remoteTreeConnection = remote;
  this.share = share;
  this.localTreeConnection = new FSTreeConnection(new FSShare('rqlocal', share.config.local));
  this.rq = new RequestQueue({
    path: share.config.work.path
  });
  share.emitShareEvent('requestqueueinit', this.rq);
  this.processor = new RQProcessor(this, share.config);

  this.processor.on('syncstart', function (eventData) {
    var data = eventData.data;
    var log = eventData.context.spi();
    log.info('start sync %s %s', data.method, data.file);
    share.emitShareEvent('syncfilestart', data);
  });

  this.processor.on('syncend', function (eventData) {
    var data = eventData.data;
    var log = eventData.context.spi();
    log.info('end sync %s %s', data.method, data.file);
    share.emitShareEvent('syncfileend', data);
  });

  this.processor.on('syncerr', function (eventData) {
    var data = eventData.data;
    var log = eventData.context.spi();
    log.error('err sync %s %s', data.method, data.file, data.err);
    share.emitShareEvent('syncfileerr', data);
  });

  this.processor.on('error', function (err) {
    logger.error('there was a general error in the processor', err);
    share.emitShareEvent('syncerr', {err: err});
  });

  this.processor.on('purged', function (purged) {
    logger.info('failed files were purged from the queue', purged);
    share.emitShareEvent('syncpurged', {files: purged});
  });

  this.processor.on('syncabort', function (data) {
    logger.info('abort sync %s', data.file);
    share.emitShareEvent('syncfileabort', data);
  });

  this.processor.on('syncprogress', function (eventData) {
    var data = eventData.data;
    var log = eventData.context.spi();
    log.debug('sync progress %s', data.path);
    share.emitShareEvent('syncfileprogress', data);
  });

  if (!options.noprocessor) {
    this.processor.start(share.config);
  }
};

util.inherits(RQTreeConnection, TreeConnection);

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
