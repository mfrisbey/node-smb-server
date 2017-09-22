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

var ntstatus = require('../ntstatus');
var SMBError = require('../smberror');
var utils = require('../utils');
var SMBContext = require('../smbcontext');

/**
 * Creates an instance of TreeConnection.
 *
 * @constructor
 * @this {TreeConnection}
 */
var TreeConnection = function (config) {
  if (!(this instanceof TreeConnection)) {
    return new TreeConnection(config);
  }
  this.config = config || {};
};

TreeConnection.prototype.createContext = function () {
  return new SMBContext();
};

/**
 * Creates a new Tree instance that can be used for interacting with the tree.
 * @param {SMBContext} context The context that will be given to the tree.
 */
TreeConnection.prototype.createTree = function (context) {
  throw new SMBError(ntstatus.STATUS_NOT_IMPLEMENTED);
};

/**
 * Disconnect this tree.
 *
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
TreeConnection.prototype.disconnect = function (cb) {
  process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_NOT_IMPLEMENTED)); });
};

module.exports = TreeConnection;
