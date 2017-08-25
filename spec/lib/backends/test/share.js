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

var RQRemoteShare = require('../../../../lib/backends/rq/remoteshare');

var TestShare = function (name, config) {
  if (!(this instanceof TestShare)) {
    return new TestShare(name, config);
  }

  RQRemoteShare.call(this, name, config);
};

util.inherits(TestShare, RQRemoteShare);

TestShare.prototype.setTree = function (tree) {
  this.tree = tree;
};

TestShare.prototype.createTree = function (context) {
  return this.tree;
};

module.exports = TestShare;
