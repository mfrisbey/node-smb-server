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

var FileConnection = require('../../spi/fileconnection');
var IPCFile = require('./file');

/**
 * Creates an instance of IPCFileConnection.
 *
 * @constructor
 * @this {IPCFileConnection}
 */
var IPCFileConnection = function (filePath, tree) {
  if (!(this instanceof IPCFileConnection)) {
    return new IPCFileConnection(filePath, tree);
  }

  FileConnection.call(this, filePath, tree);
  this.writeable = true;
};

util.inherits(IPCFileConnection, FileConnection);

IPCFileConnection.prototype.getWriteable = function () {
  return this.writeable;
};

IPCFileConnection.prototype.createFile = function (tree) {
  return new IPCFile(this, tree);
};

module.exports = IPCFileConnection;
