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

var util = require('util');

var Share = require('../../../../lib/spi/share');
var SMBContext = require('../../../../lib/smbcontext');

var TestShare = function (name, config, tree) {
    if (!(this instanceof TestShare)) {
        return new TestShare();
    }

    this.isConnected = false;
    this.tree = tree;
    this.fetchCb = function (path, cb) { cb(); };

    Share.call(this, name, config);
};

util.inherits(TestShare, Share);

TestShare.prototype.setFetchCb = function (cb) {
  this.fetchCb = cb;
};

TestShare.prototype.connect = function (session, shareLevelPassword, cb) {
    if (this.isConnected) {
        cb('test tree is already connected');
    } else {
        this.isConnected = true;
        cb(null, this.tree);
    }
};

TestShare.prototype.buildResourceUrl = function (path) {
    return 'http://localhost:4502' + path;
};

TestShare.prototype.fetchResource = function (path, cb) {
  var self = this;

  var fetchFile = function () {
    var tree = self.tree.createTree(new SMBContext().withLabel('TestFetchResource'));
    tree.open(path, function (err, file) {
      if (err) {
        cb(err);
      } else {
        self.fetchCb(file, function () {
          cb(null, path);
        });
      }
    });
  };

  if (!self.tree) {
    cb('attempting to fetch resource but no tree is defined');
  } else {
    if (!self.isConnected) {
      self.connect({}, {}, function (err, tree) {
        fetchFile();
      });
    } else {
      fetchFile();
    }
  }
};

TestShare.prototype.applyRequestDefaults = function (options) {
    return options;
};

module.exports = TestShare;
