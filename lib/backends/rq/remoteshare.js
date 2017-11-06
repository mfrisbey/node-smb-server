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
var Path = require('path');
var fs = require('fs');
var RQRemoteTreeConnection = require('./remotetreeconnection');

var mkdirp = require('mkdirp');

var DAMShare = require('../dam/share');
var utils = require('../../utils');

var RQRemoteShare = function (name, config) {
  if (!(this instanceof RQRemoteShare)) {
    return new RQRemoteShare(name, config);
  }
  config = config || {};
  this.renameLock = {};

  DAMShare.call(this, name, config);
};

util.inherits(RQRemoteShare, DAMShare);

RQRemoteShare.prototype.fetchResource = function (context, path, cb) {
  var logger = context.spi();
  var self = this;
  DAMShare.prototype.fetchResource.call(this, context, path, function (err, tmpPath) {
    if (err) {
      cb(err);
    } else {
      // move the downloaded file from its temp location to the permanent local cache
      var localPath = Path.join(self.config.local.path, path);
      mkdirp.sync(utils.getParentPath(localPath));
      logger.info('successfully downloaded %s to temp location %s. moving to permanent cache at %s', path, tmpPath, localPath);

      if (self.renameLock[localPath]) {
        // another "thread" is already attempting to move the temp file to the cache. "wait" on the calling thread.
        self.renameLock[localPath].push(cb);
      } else {
        self.renameLock[localPath] = [];
        fs.rename(tmpPath, localPath, function (err) {
          // iterate any waiting "threads" and invoke their callbacks after the rename is complete
          for (var renameCb in self.renameLock[localPath]) {
            if (err) {
              renameCb(err);
            } else {
              logger.info('notifying waiting thread about successful rename of downloaded file %s', localPath);
              renameCb(null, localPath);
            }
          }
          self.renameLock[localPath] = false;
          if (err) {
            cb(err);
          } else {
            cb(null, localPath);
          }
        });
      }
    }
  });
};

RQRemoteShare.prototype.createTreeInstance = function (content, tempFilesTree) {
  return new RQRemoteTreeConnection(this, content, tempFilesTree);
};

module.exports = RQRemoteShare;
