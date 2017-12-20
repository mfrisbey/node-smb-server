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

var util = require('util');

var File = require('../../spi/file');

/**
 * Creates an instance of RQFile.
 *
 * @constructor
 * @private
 * @this {RQFileConnection}
 * @param {File} openFile file object
 * @param {RQTree} tree tree object
 */
var RQFile = function (fileConnection, openFile, tree) {
  if (!(this instanceof RQFile)) {
    return new RQFile(fileConnection, openFile, tree);
  }
  this.openFile = openFile;
  this.remote = tree.remote;
  this.local = tree.local;

  File.call(this, fileConnection, tree);
};

// the RQFile prototype inherits from File
util.inherits(RQFile, File);

function _appendExtension(value) {
  if (this.isExtensionMode()) {
    if (this.isFile() && !this.tree.isTempFileName(value)) {
      value += '.aem';
    }
  }
  return value;
}

RQFile.prototype.isExtensionMode = function () {
  return (this.tree.isExtensionMode());
};

RQFile.prototype.getPath = function () {
  return _appendExtension.call(this, File.prototype.getPath.call(this));
};

RQFile.prototype.getName = function () {
  return _appendExtension.call(this, File.prototype.getName.call(this));
};

/**
 * Retrieves the RQ-specific logger.
 * @returns {object} A logger instance.
 */
RQFile.prototype.getRqLogger = function () {
  return this.tree.getRqLogger();
};

/**
 * Retrieves a value indicating whether the file is dirty.
 * @returns {boolean} true if it's a dirty, false otherwise
 */
RQFile.prototype.isDirty = function () {
  return this.getFileConnection().isDirty();
};

/**
 * Sets whether or no the file is dirty.
 * @param {boolean} isDirty New dirty value.
 */
RQFile.prototype.setDirty = function (isDirty) {
  this.getFileConnection().setDirty(isDirty);
};

/**
 * If necessary, caches a remote file locally for use in cached operations.
 * @param {Function} cb callback called after caching is complete
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File} cb.file File instance for consumption
 */
RQFile.prototype.cacheFile = function (cb) {
  var rqlog = this.getRqLogger();
  rqlog.debug('RQFile.cacheFile %s', this.getPath());
  var self = this;
  var tree = this.tree;
  var share = tree.share;
  var fileConnection = this.fileConnection;

  // we only want to attempt to resync the file once per file connection. if that turns out not to be enough,
  // then isSyncDone could be moved to RQFile instead, which would force more frequent checks
  if (!fileConnection.isSyncDone()) {
    share.cacheFile(self, function (err, cachedFile) {
      if (err) {
        tree.handleErr(cb, err);
      } else {
        if (cachedFile) {
          self.openFile = cachedFile;
          fileConnection.setSourceFileConnection(cachedFile.getFileConnection());
        }
        fileConnection.setSyncDone(true);
        cb(null, self.openFile);
      }
    });
  } else {
    cb(null, self.openFile);
  }
};

//---------------------------------------------------------------------< File >

/**
 * Return a flag indicating whether this is a file.
 *
 * @return {Boolean} <code>true</code> if this is a file;
 *         <code>false</code> otherwise
 */
RQFile.prototype.isFile = function () {
  return this.openFile.isFile();
};

/**
 * Return a flag indicating whether this is a directory.
 *
 * @return {Boolean} <code>true</code> if this is a directory;
 *         <code>false</code> otherwise
 */
RQFile.prototype.isDirectory = function () {
  return this.openFile.isDirectory();
};

/**
 * Return a flag indicating whether this file is read-only.
 *
 * @return {Boolean} <code>true</code> if this file is read-only;
 *         <code>false</code> otherwise
 */
RQFile.prototype.isReadOnly = function () {
  return false;
};

/**
 * Return the file size.
 *
 * @return {Number} file size, in bytes
 */
RQFile.prototype.size = function () {
  var logger = this.getLogger();
  logger.debug('[rq] size ', this.openFile.getPath());
  return this.openFile.size();
};

/**
 * Return the number of bytes that are allocated to the file.
 *
 * @return {Number} allocation size, in bytes
 */
RQFile.prototype.allocationSize = function () {
  return this.openFile.allocationSize();
};

/**
 * Return the time of last modification, in milliseconds since
 * Jan 1, 1970, 00:00:00.0.
 *
 * @return {Number} time of last modification
 */
RQFile.prototype.lastModified = function () {
  return this.openFile.lastModified();
};

/**
 * Sets the time of last modification, in milliseconds since
 * Jan 1, 1970, 00:00:00.0.
 *
 * @param {Number} ms
 * @return {Number} time of last modification
 */
RQFile.prototype.setLastModified = function (ms) {
  this.openFile.setLastModified(ms);
};

/**
 * Return the time when file status was last changed, in milliseconds since
 * Jan 1, 1970, 00:00:00.0.
 *
 * @return {Number} when file status was last changed
 */
RQFile.prototype.lastChanged = function () {
  return this.openFile.lastChanged();
};

/**
 * Return the create time, in milliseconds since Jan 1, 1970, 00:00:00.0.
 * Jan 1, 1970, 00:00:00.0.
 *
 * @return {Number} time created
 */
RQFile.prototype.created = function () {
    return this.openFile.created();
};

/**
 * Return the time of last access, in milliseconds since Jan 1, 1970, 00:00:00.0.
 * Jan 1, 1970, 00:00:00.0.
 *
 * @return {Number} time of last access
 */
RQFile.prototype.lastAccessed = function () {
  return this.openFile.lastAccessed();
};

/**
 * Read bytes at a certain position inside the file.
 *
 * @param {Buffer} buffer the buffer that the data will be written to
 * @param {Number} offset the offset in the buffer to start writing at
 * @param {Number} length the number of bytes to read
 * @param {Number} position offset where to begin reading from in the file
 * @param {Function} cb callback called with the bytes actually read
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {Number} cb.bytesRead number of bytes actually read
 * @param {Buffer} cb.buffer buffer holding the bytes actually read
 */
RQFile.prototype.read = function (buffer, offset, length, position, cb) {
  if (this.isExtensionMode()) {
    cb(null, 0, []);
    return;
  }
  var rqlog = this.getRqLogger();
  rqlog.debug('RQFile.read [%s] [%d]', this.filePath, length);
  var self = this;
  this.cacheFile(function (err, file) {
    if (err) {
      self.tree.handleErr(cb, err);
    } else {
      file.read(buffer, offset, length, position, cb);
    }
  });
};

/**
 * Write bytes at a certain position inside the file.
 *
 * @param {Buffer} data buffer to write
 * @param {Number} position position inside file
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
RQFile.prototype.write = function (data, position, cb) {
  if (this.isExtensionMode()) {
    cb();
    return;
  }
  var rqlog = this.getRqLogger();
  rqlog.debug('RQFile.write [%s] [%d] [%d]', this.filePath, data.length, position);
  var self = this;
  this.cacheFile(function (err, file) {
    if (err) {
      self.tree.handleErr(cb, err);
    } else {
      file.write(data, position, function (err) {
        if (err) {
          self.tree.handleErr(cb, err);
        } else {
          self.setDirty(true);
          cb(null);
        }
      });
    }
  });
};

/**
 * Sets the file length.
 *
 * @param {Number} length file length
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
RQFile.prototype.setLength = function (length, cb) {
  if (this.isExtensionMode()) {
    cb();
    return;
  }
  var rqlog = this.getRqLogger();
  rqlog.debug('RQFile.setLength [%s] [%d]', this.filePath, length);
  var self = this;
  this.cacheFile(function (err, file) {
    if (err) {
      self.tree.handleErr(cb, err);
    } else {
      self.setDirty(true);
      file.setLength(length, cb);
    }
  });
};

/**
 * Delete this file or directory. If this file denotes a directory, it must
 * be empty in order to be deleted.
 *
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
RQFile.prototype.delete = function (cb) {
  var logger = this.getLogger();
  var rqlog = this.getRqLogger();
  rqlog.debug('RQFile.delete %s', this.filePath);
  var self = this;
  logger.debug('deleting file %s', self.getPath());

  var sendResult = function(err) {
    if (err) {
      self.tree.handleErr(cb, err);
    } else {
      logger.debug('successfully deleted %s', self.getPath());
      self.setDirty(false);
      cb();
    }
  };

  if (self.isDirectory()) {
    self.tree.deleteDirectory(self.getPath(), function (err) {
      sendResult(err);
    });
  } else {
    self.tree.delete(self.getPath(), function (err) {
      sendResult(err);
    });
  }
};

/**
 * Flush the contents of the file to disk.
 *
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
RQFile.prototype.flush = function (cb) {
  var rqlog = this.getRqLogger();
  rqlog.debug('RQFile.flush %s', this.filePath);
  var self = this;
  this.cacheFile(function (err, file) {
    if (err) {
      self.tree.handleErr(cb, err);
    } else {
      file.flush(cb);
    }
  });
};

/**
 * Close this file, releasing any resources.
 *
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
RQFile.prototype.close = function (cb) {
  var logger = this.getLogger();
  var rqlog = this.getRqLogger();
  rqlog.debug('RQFile.close %s', this.filePath);
  var self = this;
  this.openFile.close(function (err) {
    if (err) {
      self.tree.handleErr(cb, err);
    } else {
      if (self.isDirty()) {
        logger.debug('%s is dirty, queueing method', self.getPath());
        self.tree.isCreatedLocally(self.getPath(), function (err, isLocal) {
          if (err) {
            self.tree.handleErr(cb, err);
          } else if (isLocal) {
            logger.debug('%s is newly created, queuing creation', self.getPath());
            self.tree.queueData(self.getPath(), 'PUT', false, cb);
          } else {
            logger.debug('%s is being updated, queuing update', self.getPath());
            self.tree.queueData(self.getPath(), 'POST', false, cb);
          }
        });
      } else {
        logger.debug('%s is not dirty, closing', self.getPath());
        cb();
      }
    }
  });
};

module.exports = RQFile;
