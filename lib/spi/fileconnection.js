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

var utils = require('../utils');

/**
 * Creates an instance of FileConnection.
 *
 * @constructor
 * @param {string} filePath Path of the file.
 * @param {Tree} tree Tree creating the connection.
 * @this {FileConnection}
 */
var FileConnection = function (filePath, tree) {
  if (!(this instanceof FileConnection)) {
    return new FileConnection(filePath, tree);
  }

  this.filePath = tree.unicodeNormalize(filePath);
  this.fileName = utils.getPathName(this.filePath);
  this.treeConnection = tree.treeConnection;
};

/**
 * Retrieves the configuration of the share.
 * @returns {Object} An object containing configuration information.
 */
FileConnection.prototype.getConfig = function () {
  return this.treeConnection.getConfig();
};

/**
 * Retrieves the path of the connected file.
 * @returns {String} A file's path.
 */
FileConnection.prototype.getFilePath = function () {
  return this.filePath;
};

/**
 * Retrieves the name (only) of the file.
 * @returns {String} The file's name.
 */
FileConnection.prototype.getName = function () {
  return this.fileName;
};

/**
 * Return the TreeConnection.
 *
 * @return {TreeConnection}
 */
FileConnection.prototype.getTreeConnection = function () {
  return this.treeConnection;
};

/**
 * Creates a new File instance using the connection's information.
 * @param {Tree} tree Will be given to the new File instance.
 * @return {File} Newly created instance.
 */
FileConnection.prototype.createFile = function (tree) {
  throw new Error('abstract method');
};

module.exports = FileConnection;
