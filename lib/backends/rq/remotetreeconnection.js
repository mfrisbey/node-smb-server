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

var DAMTreeConnection = require('../dam/treeconnection');
var RQRemoteTree = require('./remotetree');

/**
 * Creates an instance of TreeConnection.
 *
 * @constructor
 * @this {DAMTreeConnection}
 */
var RQRemoteTreeConnection = function (share, content, tempFilesTree) {
  if (!(this instanceof RQRemoteTreeConnection)) {
    return new RQRemoteTreeConnection(share, content, tempFilesTree);
  }
  DAMTreeConnection.call(this, share, content, tempFilesTree);
  this.share = share;
  this.content = content;
  this.tempFilesTree = tempFilesTree;
};

util.inherits(RQRemoteTreeConnection, DAMTreeConnection);

/**
 * Creates a new Tree instance that can be used for interacting with the tree.
 * @param {SMBContext} context The context that will be given to the tree.
 */
RQRemoteTreeConnection.prototype.createTree = function (context) {
  return new RQRemoteTree(this, context);
};

/**
 * Disconnect this tree.
 *
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
RQRemoteTreeConnection.prototype.disconnect = function (cb) {
  DAMTreeConnection.prototype.disconnect.call(this, cb);
};

module.exports = RQRemoteTreeConnection;
