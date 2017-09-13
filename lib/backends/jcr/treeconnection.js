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

var logger = require('winston').loggers.get('spi');
var tmp = require('temp').track();  // cleanup on exit

var TreeConnection = require('../../spi/treeconnection');
var JCRTree = require('./tree');

/**
 * Creates an instance of TreeConnection.
 *
 * @constructor
 * @this {JCRTreeConnection}
 */
var JCRTreeConnection = function (share, content, tempFilesTree) {
  if (!(this instanceof JCRTreeConnection)) {
    return new JCRTreeConnection(share, content, tempFilesTree);
  }
  TreeConnection.call(this, share.config);
  this.share = share;
  this.content = content;
  this.tempFilesTree = tempFilesTree;
};

util.inherits(JCRTreeConnection, TreeConnection);

/**
 * Creates a new Tree instance that can be used for interacting with the tree.
 * @param {SMBContext} context The context that will be given to the tree.
 */
JCRTreeConnection.prototype.createTree = function (context) {
  return new JCRTree(this, context);
};

/**
 * Disconnect this tree.
 *
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
JCRTreeConnection.prototype.disconnect = function (cb) {
  logger.debug('[%s] tree.disconnect', this.share.config.backend);
  var self = this;
  tmp.cleanup(function (ignored) {
    // let share do its cleanup tasks
    self.share.disconnect(cb);
  });
};

module.exports = JCRTreeConnection;
