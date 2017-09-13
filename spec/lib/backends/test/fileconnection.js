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
var TestFile = require('./file');

/**
 * Creates an instance of TestFileConnection.
 *
 * @constructor
 * @this {TestFileConnection}
 */
var TestFileConnection = function (filePath, tree) {
  if (!(this instanceof TestFileConnection)) {
    return new TestFileConnection(filePath, tree);
  }

  FileConnection.call(this, filePath, tree);
};

util.inherits(TestFileConnection, FileConnection);

/**
 * Creates a new File instance using the connection's information.
 * @param {Tree} tree Will be given to the new File instance.
 * @return {File} Newly created instance.
 */
TestFileConnection.prototype.createFile = function (tree) {
  return new TestFile(this, tree);
};

module.exports = TestFileConnection;
