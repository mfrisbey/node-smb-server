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
 * Creates an instance of Tree.
 *
 * @constructor
 * @this {Tree}
 */
var Tree = function (config) {
  if (!(this instanceof Tree)) {
    return new Tree(config);
  }
  this.config = config || {};
};

function _sendNotImplemented(context, label, cb) {
  if (context.getLabel() == label) {
    cb(new SMBError(ntstatus.STATUS_NOT_IMPLEMENTED));
    return true;
  } else {
    return false;
  }
}

/**
 * Test whether or not the specified file exists.
 *
 * @param {String} name file name
 * @param {Function} cb callback called with the result
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {Boolean} cb.exists true if the file exists; false otherwise
 */
Tree.prototype.exists = function (name, cb) {
  this.existsExt(new SMBContext().withLabel('SPITree.Exists').requestless(), name, cb);
};

/**
 * Extended version of exists to test whether or not the specified file exists.
 *
 * @param {SMBContext} context Additional information that can provide enhanced capabilities throughout the workflow.
 * @param {String} name file name
 * @param {Function} cb callback called with the result
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {Boolean} cb.exists true if the file exists; false otherwise
 */
Tree.prototype.existsExt = function (context, name, cb) {
  // protect against infinite call stack and preserve backward-compatibility
  if (!_sendNotImplemented(context, 'SPITree.Exists', cb)) {
    this.exists(name, cb);
  }
};

/**
 * Open an existing file.
 *
 * @param {String} name file name
 * @param {Function} cb callback called with the opened file
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File} cb.file opened file
 */
Tree.prototype.open = function (name, cb) {
  this.openExt(new SMBContext().withLabel('SPITree.Open').requestless(), name, cb);
};

/**
 * Extended version of open to open an existing file.
 *
 * @param {SMBContext} context Additional information that can provide enhanced capabilities throughout the workflow.
 * @param {String} name file name
 * @param {Function} cb callback called with the opened file
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File} cb.file opened file
 */
Tree.prototype.openExt = function (context, name, cb) {
  // protect against infinite call stack and preserve backward-compatibility
  if (!_sendNotImplemented(context, 'SPITree.Open', cb)) {
    this.open(name, cb);
  }
};

/**
 * List entries, matching a specified pattern.
 *
 * @param {String} pattern pattern
 * @param {Function} cb callback called with an array of matching files
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File[]} cb.files array of matching files
 */
Tree.prototype.list = function (pattern, cb) {
  this.listExt(new SMBContext().withLabel('SPITree.List').requestless(), pattern, cb);
};

/**
 * Extended version of list to list entries, matching a specified pattern.
 *
 * @param {SMBContext} context Additional information that can provide enhanced capabilities throughout the workflow.
 * @param {String} pattern pattern
 * @param {Function} cb callback called with an array of matching files
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File[]} cb.files array of matching files
 */
Tree.prototype.listExt = function (context, pattern, cb) {
  // protect against infinite call stack and preserve backward-compatibility
  if (!_sendNotImplemented(context, 'SPITree.List', cb)) {
    this.list(pattern, cb);
  }
};

/**
 * Create a new file.
 *
 * @param {String} name file name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File} cb.file created file
 */
Tree.prototype.createFile = function (name, cb) {
  this.createFileExt(new SMBContext().withLabel('SPITree.CreateFile').requestless(), name, cb);
};

/**
 * Extended version of createFile to create a new file.
 *
 * @param {SMBContext} context Additional information that can provide enhanced capabilities throughout the workflow.
 * @param {String} name file name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File} cb.file created file
 */
Tree.prototype.createFileExt = function (context, name, cb) {
  // protect against infinite call stack and preserve backward-compatibility
  if (!_sendNotImplemented(context, 'SPITree.CreateFile', cb)) {
    this.createFile(name, cb);
  }
};

/**
 * Create a new directory.
 *
 * @param {String} name directory name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File} cb.file created directory
 */
Tree.prototype.createDirectory = function (name, cb) {
  this.createDirectoryExt(new SMBContext().withLabel('SPITree.CreateDirectory').requestless(), name, cb);
};

/**
 * Extended version of createDirectory to create a new directory.
 *
 * @param {SMBContext} context Additional information that can provide enhanced capabilities throughout the workflow.
 * @param {String} name directory name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File} cb.file created directory
 */
Tree.prototype.createDirectoryExt = function (context, name, cb) {
  // protect against infinite call stack and preserve backward-compatibility
  if (!_sendNotImplemented(context, 'SPITree.CreateDirectory', cb)) {
    this.createDirectory(name, cb);
  }
};

/**
 * Delete a file.
 *
 * @param {String} name file name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
Tree.prototype.delete = function (name, cb) {
  this.deleteExt(new SMBContext().withLabel('SPITree.Delete').requestless(), name, cb);
};

/**
 * Extended version of delete to delete a file.
 *
 * @param {SMBContext} context Additional information that can provide enhanced capabilities throughout the workflow.
 * @param {String} name file name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
Tree.prototype.deleteExt = function (context, name, cb) {
  // protect against infinite call stack and preserve backward-compatibility
  if (!_sendNotImplemented(context, 'SPITree.Delete', cb)) {
    this.delete(name, cb);
  }
};

/**
 * Delete a directory. It must be empty in order to be deleted.
 *
 * @param {String} name directory name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
Tree.prototype.deleteDirectory = function (name, cb) {
  this.deleteDirectoryExt(new SMBContext().withLabel('SPITree.DeleteDirectory').requestless(), name, cb);
};

/**
 * Extended version of deleteDirectory to delete a directory. It must be empty in order to be deleted.
 *
 * @param {SMBContext} context Additional information that can provide enhanced capabilities throughout the workflow.
 * @param {String} name directory name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
Tree.prototype.deleteDirectoryExt = function (context, name, cb) {
  // protect against infinite call stack and preserve backward-compatibility
  if (!_sendNotImplemented(context, 'SPITree.DeleteDirectory', cb)) {
    this.deleteDirectory(name, cb);
  }
};

/**
 * Rename a file or directory.
 *
 * @param {String} oldName old name
 * @param {String} newName new name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
Tree.prototype.rename = function (oldName, newName, cb) {
  this.renameExt(new SMBContext().withLabel('SPITree.Rename').requestless(), oldName, newName, cb);
};

/**
 * Extended version of rename to rename a file or directory.
 *
 * @param {SMBContext} context Additional information that can provide enhanced capabilities throughout the workflow.
 * @param {String} oldName old name
 * @param {String} newName new name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
Tree.prototype.renameExt = function (context, oldName, newName, cb) {
  // protect against infinite call stack and preserve backward-compatibility
  if (!_sendNotImplemented(context, 'SPITree.Rename', cb)) {
    this.rename(oldName, newName, cb);
  }
};

/**
 * Refresh a specific folder.
 *
 * @param {String} folderPath
 * @param {Boolean} deep
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
Tree.prototype.refresh = function (folderPath, deep, cb) {
  this.refreshExt(new SMBContext().withLabel('SPITree.Refresh').requestless(), folderPath, deep, cb);
};

/**
 * Extended version of refresh to refresh a specific folder.
 *
 * @param {SMBContext} context Additional information that can provide enhanced capabilities throughout the workflow.
 * @param {String} folderPath
 * @param {Boolean} deep
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
Tree.prototype.refreshExt = function (context, folderPath, deep, cb) {
  // protect against infinite call stack and preserve backward-compatibility
  if (!_sendNotImplemented(context, 'SPITree.Refresh', cb)) {
    this.refresh(folderPath, deep, cb);
  }
};

/**
 * Disconnect this tree.
 *
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
Tree.prototype.disconnect = function (cb) {
  process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_NOT_IMPLEMENTED)); });
};

/**
 * Normalizes a unicode string in order to avoid issues related to different code points.
 * @param {String} str The value to be normalized.
 * @returns {String} A normalized string value.
 */
Tree.prototype.unicodeNormalize = function (str) {
  if (!this.config.noUnicodeNormalize) {
    return utils.unicodeNormalize(str);
  } else {
    return str;
  }
};

/**
 * Determines if two strings are equal based on their normalized unicode values.
 * @param {String} str1 The first value to be compared.
 * @param {String} str2 The second value to be compared.
 * @returns {Boolean} true if the two values are equal, otherwise false.
 */
Tree.prototype.unicodeEquals = function (str1, str2) {
  if (!this.config.noUnicodeNormalize) {
    return utils.unicodeEquals(str1, str2);
  } else {
    return str1 == str2;
  }
};

/**
 * Clears the tree's cache. Default implementation does nothing.
 * @param {function} cb Will be invoked when the operation is complete.
 * @param {string|Error} cb.err Will be truthy if there were errors during the operation.
 */
Tree.prototype.clearCache = function (cb) {
  cb();
};

module.exports = Tree;
