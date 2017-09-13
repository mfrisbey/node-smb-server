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

var TreeConnection = require('../../../../lib/spi/treeconnection');
var TestTree = require('./tree');

var util = require('util');

/**
 * Creates an instance of TreeConnection.
 *
 * @constructor
 * @this {TreeConnection}
 */
var TestTreeConnection = function (share, urlPrefix, request) {
  if (!(this instanceof TestTreeConnection)) {
    return new TestTreeConnection(share, urlPrefix, request);
  }

  TreeConnection.call(this, share.config);

  this.share = share;
  this.urlPrefix = urlPrefix;
  this.request = request;
};

util.inherits(TestTreeConnection, TreeConnection);

/**
 * Creates a new Tree instance that can be used for interacting with the tree.
 * @param {SMBContext} context The context that will be given to the tree.
 */
TestTreeConnection.prototype.createTree = function (context) {
  return new TestTree(this, context);
};

/**
 * Disconnect this tree.
 *
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
TestTreeConnection.prototype.disconnect = function (cb) {
  // there's nothing to do here
  process.nextTick(function () { cb(); });
};

module.exports = TestTreeConnection;
