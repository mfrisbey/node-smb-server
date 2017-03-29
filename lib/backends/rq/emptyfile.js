/*
 *  Copyright 2016 Adobe Systems Incorporated. All rights reserved.
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

var logger = require('winston').loggers.get('spi');

var util = require('util');

var File = require('../../spi/file');

/**
 * Creates an instance of EmptyFile.
 *
 * @constructor
 * @private
 * @this {EmptyFile}
 * @param {File} openFile file object
 * @param {RQTree} tree tree object
 */
var EmptyFile = function (path, isDirectory, tree) {
  if (!(this instanceof EmptyFile)) {
    return new EmptyFile(path, isDirectory, tree);
  }
  this.tree = tree;
  this.isDir = isDirectory;
  File.call(this, path, tree);
};

// the EmptyFile prototype inherits from File
util.inherits(EmptyFile, File);

EmptyFile.prototype.isFile = function () {
  return !this.isDir;
};

EmptyFile.prototype.isDirectory = function () {
  return this.isDir;
};

EmptyFile.prototype.isReadOnly = function () {
  return true;
};

EmptyFile.prototype.size = function () {
  return 0;
};

EmptyFile.prototype.allocationSize = function () {
  return 0;
};

EmptyFile.prototype.lastModified = function () {
  return 0;
};

EmptyFile.prototype.setLastModified = function (ms) {
  return 0;
};

EmptyFile.prototype.lastChanged = function () {
  return 0;
};

EmptyFile.prototype.created = function () {
  return 0;
};

EmptyFile.prototype.lastAccessed = function () {
  return 0;
};

EmptyFile.prototype.read = function (buffer, offset, length, position, cb) {
  cb();
};

EmptyFile.prototype.write = function (data, position, cb) {
  cb();
};

EmptyFile.prototype.setLength = function (length, cb) {
  cb();
};

EmptyFile.prototype.delete = function (cb) {
  cb();
};

EmptyFile.prototype.flush = function (cb) {
  cb();
};

EmptyFile.prototype.close = function (cb) {
  cb();
};

module.exports = EmptyFile;
