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

var TreeConnection = require('../../spi/treeconnection');
var FSTree = require('./tree');

var logger = require('winston').loggers.get('spi');
var util = require('util');

/**
 * Creates an instance of TreeConnection.
 *
 * @constructor
 * @this {TreeConnection}
 */
var FSTreeConnection = function (share) {
  if (!(this instanceof FSTreeConnection)) {
    return new FSTreeConnection(share);
  }

  TreeConnection.call(this, share.config);

  this.share = share;
};

util.inherits(FSTreeConnection, TreeConnection);

/**
 * Creates a new Tree instance that can be used for interacting with the tree.
 * @param {SMBContext} context The context that will be given to the tree.
 */
FSTreeConnection.prototype.createTree = function (context) {
  return new FSTree(this, context);
};

/**
 * Disconnect this tree.
 *
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
FSTreeConnection.prototype.disconnect = function (cb) {
  logger.debug('[%s] tree.disconnect', this.share.config.backend);
  // there's nothing to do here
  process.nextTick(function () { cb(); });
};

module.exports = FSTreeConnection;
