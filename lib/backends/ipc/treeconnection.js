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

var TreeConnection = require('../../spi/treeconnection');
var IPCTree = require('./tree');

/**
 * Creates an instance of TreeConnection.
 *
 * @constructor
 * @this {TreeConnection}
 */
var IPCTreeConnection = function (share) {
  if (!(this instanceof IPCTreeConnection)) {
    return new IPCTreeConnection(share);
  }
  TreeConnection.call(this, share.config);
  this.share = share;
};

util.inherits(IPCTreeConnection, TreeConnection);

/**
 * Creates a new Tree instance that can be used for interacting with the tree.
 * @param {SMBContext} context The context that will be given to the tree.
 */
IPCTreeConnection.prototype.createTree = function (context) {
  return new IPCTree(this, context);
};

/**
 * Disconnect this tree.
 *
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
IPCTreeConnection.prototype.disconnect = function (cb) {
  logger.debug('[ipc] tree.disconnect');
  process.nextTick(function () { cb(); });
};

module.exports = IPCTreeConnection;
