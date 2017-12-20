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

var common = require('../../test-common');
var async = require('async');
var RQShare = common.require(__dirname, '../../../../lib/backends/rq/share');
var RQRemoteTreeConnection = common.require(__dirname, '../../../../lib/backends/rq/remotetreeconnection');
var util = require('util');
var utils = common.require(__dirname, '../../../../lib/utils');
var consts = common.require(__dirname, '../../../../lib/backends/rq/common');
var Path = require('path');
var SMBContext = common.require(__dirname, '../../../../lib/smbcontext');
var MockRepo = require('./mock-repository');

function RQCommon(config) {
  var self = this;
  common.call(this);

  var host = RQCommon.getHost();
  var port = RQCommon.getPort();

  self.mockRepo = new MockRepo();
  self.hostPrefix = RQCommon.getHostRemotePrefix();
  self.urlPrefix = RQCommon.getFullRemotePrefix();

  self.remotePrefix = RQCommon.getRemotePrefix();
  self.localPrefix = RQCommon.getLocalPrefix();

  self.config = config;
  if (!self.config) {
    self.config = {
      backend: 'rqtest',
      modifiedThreshold: 100,
      description: 'test remote share',
      path: self.remotePrefix,
      local: {
        backend: 'localfs',
        description: 'test local share',
        path: self.localPrefix
      },
      work: {
        backend: 'workfs',
        path: '/work/path'
      },
      contentCacheTTL: 200,
      preserveCacheFiles: [
        consts.REQUEST_DB
      ],
      host: host,
      port: port,
      noprocessor: true
    };
  }

  var context = new SMBContext().withLabel('UnitTest');
  self.testContext = context;

  self.testShare = new RQShare('rq', self.config);
  var remoteShare = self.testShare.remote;
  self.remoteTreeConnection = new RQRemoteTreeConnection(remoteShare);
  self.testTreeConnection = self.testShare.createTree(self.remoteTreeConnection, self.config);
  self.testTree = self.testTreeConnection.createTree(context);
  self.remoteTree = self.testTree.remote;
  self.localTree = self.testTree.local;
  self.localRawTree = self.localTree.source;

  function _pathFromUrl(url) {
    var path = url.substr(self.urlPrefix.length);
    path = decodeURI(path);
    return path;
  }

  function getEntityJson(path, includeContent, cb) {
    self.mockRepo.getEntity(path, function (entity) {
      var statusCode = 404;
      var data = '';
      if (entity) {
        statusCode = 200;
        if (includeContent) {
          data = JSON.stringify(entity);
        }
      }
      cb(null, statusCode, data);
    });
  }

  function stripUrlPrefix(url) {
    var toStrip = self.urlPrefix + self.remotePrefix;
    if (url.indexOf(toStrip) >= 0) {
      url = url.substr(toStrip.length);
    }
    return url;
  }

  self.jsonSelector = '.json?limit=9999&showProperty=jcr:created&showProperty=jcr:lastModified&showProperty=asset:size&showProperty=asset:readonly&showProperty=cq:drivelock';
  var rootJsonUrl = 'http://' + self.config.host + ':' + self.config.port + '/api/assets' + self.config.path + self.jsonSelector;
  self.request.registerUrl(rootJsonUrl, function (url, headers, cb) {
    getEntityJson('/', true, cb);
  });

  self.request.setRequestCallback(function (url, method, headers, options, cb) {
    var path = stripUrlPrefix(url);
    if (method == 'POST') {
      var jsonUrl = url + self.jsonSelector;
      var jsonUrlShort = url + '.json';
      var name = utils.getPathName(path);
      var entityData;
      if (headers['Content-Type'] == 'application/json; charset=utf-8') {
        entityData = MockRepo.getFolderData(name);
      } else {
        entityData = MockRepo.getFileData(name, options.data.length);
      }
      self.mockRepo.addEntity(path, entityData, function () {
        self.request.registerUrl(jsonUrl, function (url, headers, jsonCallback) {
          getEntityJson(path, true, jsonCallback);
        });
        self.request.registerUrl(jsonUrlShort, function (url, headers, jsonCallback) {
          getEntityJson(path, false, jsonCallback);
        });
        cb();
      });
    } else if (method == 'PUT') {
      self.mockRepo.setSize(path, options.data.length, cb);
    } else if (method == 'DELETE') {
      self.mockRepo.delete(path, cb);
    } else if (method == 'MOVE') {
      var targetUrl = headers['X-Destination'];
      var targetPath = stripUrlPrefix(targetUrl);
      var targetJsonUrl = targetUrl + self.jsonSelector;
      var targetJsonUrlShort = targetUrl + '.json';
      self.mockRepo.move(path, targetPath, function () {
        self.request.unregisterUrl(jsonUrl);
        self.request.unregisterUrl(jsonUrlShort);
        self.request.registerUrl(targetJsonUrl, function (url, headers, jsonCallback) {
          getEntityJson(targetPath, true, jsonCallback);
        });
        self.request.registerUrl(targetJsonUrlShort, function (url, headers, jsonCallback) {
          getEntityJson(targetPath, false, jsonCallback);
        });
        cb();
      });
    } else {
      cb();
    }
  });

  spyOn(self.remoteTree, 'exists').andCallThrough();
  spyOn(self.remoteTree, 'open').andCallThrough();
  spyOn(self.remoteTree, 'delete').andCallThrough();
  spyOn(self.remoteTree, 'deleteDirectory').andCallThrough();
  spyOn(self.localTree, 'exists').andCallThrough();
  spyOn(self.testShare, 'emit').andCallThrough();
};

util.inherits(RQCommon, common);

RQCommon.require = common.require;

RQCommon.getLocalPrefix = function () {
  return '/local/path';
};

RQCommon.getHostRemotePrefix = function () {
  return 'http://' + RQCommon.getHost() + ':' + RQCommon.getPort();
};

RQCommon.getFullRemotePrefix = function () {
  return 'http://' + RQCommon.getHost() + ':' + RQCommon.getPort() + '/api/assets';
};

RQCommon.getFullRemotePrefixWithPath = function () {
  return RQCommon.getFullRemotePrefix() + RQCommon.getRemotePrefix();
};

RQCommon.getRemotePrefix = function () {
  return '/remote/path';
};

RQCommon.getHost = function () {
  return 'testlocalhost';
};

RQCommon.getPort = function () {
  return 19070;
};

RQCommon.isLocalTree = function (tree) {
  return tree.getSourceTree ? true : false;
};

RQCommon.isRQFile = function (file) {
  return file.cacheFile ? true : false;
};

RQCommon.prototype.clearRemoteCache = function () {
  this.testShare.invalidateContentCache(this.testTree, '/', true);
  this.testShare.remote.cachedBinaries = {};
};

RQCommon.prototype.wasPathRequested = function (path) {
  return this.request.wasUrlRequested(this.urlPrefix + path);
};

RQCommon.prototype.getPathMethodRequestCount = function (path, method) {
  var testPath = RQCommon.getFullRemotePrefix() + RQCommon.getRemotePrefix() + path;
  return this.request.getUrlMethodRequestCount(testPath, method);
};

RQCommon.prototype.registerLocalPath = function (path, cb) {
  this.fs.registerPath(this.localPrefix + path, cb);
};

RQCommon.prototype.registerUrl = function (path, cb) {
  this.request.registerUrl(this.urlPrefix + this.remotePrefix + path, cb);
};

RQCommon.prototype.setUrlData = function (path, data) {
  this.request.setUrlData(this.urlPrefix + this.remotePrefix + path, data);
};

RQCommon.prototype.registerInfoUrl = function (path, cb) {
  if (path == '/') {
    path = '';
  }
  this.request.registerUrl(this.urlPrefix + this.remotePrefix + path + this.jsonSelector, cb);
};

RQCommon.prototype.registerPathStatusCode = function (path, statusCode) {
  this.request.registerUrlStatusCode(this.urlPrefix + this.remotePrefix + path, statusCode);
};

RQCommon.prototype.setRemoteFileReadOnly = function (path, readOnly, cb) {
  this.mockRepo.setReadOnly(path, readOnly, cb);
};

RQCommon.prototype.setRemoteFileLastModified = function (path, lastModified, cb) {
  this.mockRepo.setLastModified(path, lastModified, cb);
};

RQCommon.prototype.getFileContent = function (file, cb) {
  var buffer = new Array(file.size());
  file.read(buffer, 0, file.size(), 0, function (err) {
    expect(err).toBeFalsy();
    cb(buffer.join(''));
  });
};

RQCommon.prototype.addDirectory = function (tree, dirName, cb) {
  if (RQCommon.isLocalTree(tree)) {
    // for compatibility, force use of raw local tree if RQLocalTree is provided.
    tree = this.localRawTree;
  }
  tree.createDirectory(dirName, function (err, file) {
    expect(err).toBeFalsy();
    cb(file);
  });
};

RQCommon.prototype.addRemoteFileWithContent = function (fileName, content, cb) {
  var self = this;
  this.addFile(this.remoteTree, fileName, function () {
    self.setUrlData(fileName, content);
    self.clearRemoteCache();
    self.mockRepo.setSize(fileName, content.length, cb);
  });
};

RQCommon.prototype.addFileWithContent = function (tree, fileName, content, cb) {
  if (tree.isTempFileNameForce) {
    this.addRemoteFileWithContent(fileName, content, cb);
  } else {
    var self = this;
    self.addFile(tree, fileName, function (file, tree) {
      file.setLength(content.length, function (err) {
        expect(err).toBeFalsy();
        file.write(content, 0, function (err) {
          expect(err).toBeFalsy();
          file.close(function (err) {
            expect(err).toBeFalsy();
            tree.open(fileName, function (err, file) {
              expect(err).toBeFalsy();
              cb(file);
            });
          });
        });
      });
    });
  }
};

RQCommon.prototype.addRawLocalFile = function (path, cb) {
  this.fs.createEntity(Path.join(this.localPrefix, path), false, cb);
};

RQCommon.prototype.addFile = function (tree, fileName, cb) {
  if (RQCommon.isLocalTree(tree)) {
    // for compatibility, force use of raw local tree if RQLocalTree is provided.
    tree = this.localRawTree;
  }
  tree.createFile(fileName, function (err, file) {
    expect(err).toBeFalsy();
    cb(file, tree);
  });
};

RQCommon.prototype.addRemoteFileWithDates = function (path, content, created, lastModified, cb) {
  var self = this;
  this.addFile(this.remoteTree, path, function () {
    self.mockRepo.setLastModified(path, lastModified, function () {
      self.mockRepo.setCreated(path, created, function () {
        self.setUrlData(path, content);
        self.clearRemoteCache();
        self.mockRepo.setSize(path, content.length, cb);
      });
    });
  });
};

RQCommon.prototype.addFileWithDates = function (tree, path, content, created, lastModified, cb) {
  if (tree.isTempFileNameForce) {
    this.addRemoteFileWithDates(path, content, created, lastModified, cb);
  } else {
    var self = this;
    var filePath = Path.join(tree.share.path, path);
    self.fs.createEntityWithDates(filePath, false, content, new Date(created), new Date(lastModified), function (err) {
      expect(err).toBeFalsy();
      tree.open(path, function (err, file) {
        expect(err).toBeFalsy();
        if (tree.registerFileUrl) {
          tree.registerFileUrl(path);
        }
        cb(file);
      });
    });
  }
};

RQCommon.prototype.addFiles = function (tree, numFiles, cb) {
  var self = this;
  var addTreeFile = function (index) {
    if (index < numFiles) {
      self.addFile(tree, '/testfile' + (index + 1), function () {
        addTreeFile(index + 1);
      });
    } else {
      cb();
    }
  };
  addTreeFile(0);
};

RQCommon.prototype.addLocalFile = function (fileName, cb) {
  var self = this;
  self.addFile(self.localTree, fileName, function (file) {
    self.localTree.createFromSource(file, file, false, function (err) {
      expect(err).toBeFalsy();
      cb();
    });
  });
};

RQCommon.prototype.addLocalFiles = function (numFiles, cb) {
  var self = this;
  var count = 0;

  async.whilst(function () {
    return count < numFiles;
  }, function (whilstCb) {
    self.addLocalFile('/testfile' + (count + 1), whilstCb);
    count++;
  }, function (err) {
    expect(err).toBeFalsy();
    cb();
  });
};

RQCommon.prototype.addLocalFileWithDates = function (path, readOnly, content, created, lastModified, cb) {
  this.addFileWithDates(this.localRawTree, path, content, created, lastModified, cb);
};

RQCommon.prototype.expectLocalFileExistExt = function (fileName, localExists, workExists, createExists, cb) {
  var self = this;
  self.localTree.exists(fileName, function (err, exists) {
    expect(err).toBeFalsy();
    expect(exists).toEqual(localExists);
    self.localTree.cacheInfoExists(fileName, function (err, exists) {
      expect(err).toBeFalsy();
      expect(exists).toEqual(workExists);
      if (exists) {
        self.localTree.isCreatedLocally(fileName, function (err, exists) {
          expect(err).toBeFalsy();
          expect(exists).toEqual(createExists);
          cb();
        });
      } else {
        expect(false).toEqual(createExists);
        cb();
      }
    });
  });
};

RQCommon.prototype.expectLocalFileExist = function (fileName, doesExist, createExist, cb) {
  this.expectLocalFileExistExt(fileName, doesExist, doesExist, createExist, cb);
};

RQCommon.prototype.expectPathExist = function (tree, path, doesExist, cb) {
  tree.exists(path, function (err, exists) {
    expect(err).toBeFalsy();
    expect(exists).toEqual(doesExist);
    cb();
  });
};

RQCommon.prototype.expectFileModifiedDate = function (path, modifiedTime, toEqual, cb) {
  var self = this;
  self.testTree.open(path, function (err, file) {
    expect(err).toBeFalsy();
    if (toEqual) {
      expect(file.lastModified()).toEqual(toEqual);
    } else {
      expect(file.lastModified()).not.toEqual(toEqual);
    }
    cb();
  });
};

RQCommon.prototype.expectQueuedMethod = function (path, name, method, cb) {
  this.testTree.rq.getRequests(this.testContext, path, function (err, lookup) {
    expect(err).toBeFalsy();
    if (method) {
      expect(lookup[name]).toEqual(method);
    } else {
      expect(lookup[name]).toBeUndefined();
    }
    cb();
  });
};

RQCommon.prototype.addQueuedFile = function (path, cb) {
  var self = this;
  self.testTree.createFile(path, function (err, file) {
    expect(err).toBeFalsy();
    file.setLength(path.length, function (err) {
      expect(err).toBeFalsy();
      file.write(path, 0, function (err) {
        expect(err).toBeFalsy();
        file.close(function (err) {
          expect(err).toBeFalsy();
          self.expectLocalFileExist(path, true, true, function () {
            self.expectQueuedMethod(utils.getParentPath(path), utils.getPathName(path), 'PUT', function () {
              self.testTree.open(path, function (err, newFile) {
                expect(err).toBeFalsy();
                cb(newFile);
              });
            });
          });
        });
      });
    });
  });
};

RQCommon.prototype.addCachedFile = function (path, cb) {
  var c = this;
  c.addFile(c.remoteTree, path, function () {
    c.testTree.open(path, function (err, file) {
      expect(err).toBeFalsy();
      file.cacheFile(function (err) {
        expect(err).toBeFalsy();
        file.close(function (err) {
          expect(err).toBeFalsy();
          cb();
        });
      });
    });
  });
};

RQCommon.prototype.addDeletedFile = function (path, cb) {
  var c = this;
  c.addCachedFile(path, function () {
    c.testTree.delete(path, function (err) {
      expect(err).toBeFalsy();
      c.expectQueuedMethod(utils.getParentPath(path), utils.getPathName(path), 'DELETE', function () {
        c.expectLocalFileExist(path, false, false, cb);
      });
    });
  });
};

RQCommon.prototype.addLocallyModifiedFile = function (path, cb) {
  var c = this;
  c.addCachedFile(path, function () {
    c.testTree.open(path, function (err, file) {
      expect(err).toBeFalsy();
      expect(file).toBeTruthy();
      file.setLength(10, function (err) {
        expect(err).toBeFalsy();
        file.close(function (err) {
          expect(err).toBeFalsy();
          c.expectQueuedMethod(utils.getParentPath(path), utils.getPathName(path), 'POST', function () {
            c.expectLocalFileExist(path, true, false, cb);
          });
        });
      });
    });
  });
};

module.exports = RQCommon;
