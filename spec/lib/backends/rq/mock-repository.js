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

var Datastore = require('nedb');
var utils = require('../../../../lib/utils');

function MockRepository() {
  this.db = new Datastore();
  this.root = {
    path: '/',
    entity: MockRepository.getFolderData('assets')
  };
};

MockRepository.getFolderData = function (name) {
  return {
    class: ['assets/folder'],
    properties: {
      'jcr:created': MockRepository.toDateString(new Date().getTime()),
      name: decodeURI(name)
    }
  };
};

MockRepository.getFileData = function (name, size) {
  var currDate = MockRepository.toDateString(new Date().getTime());
  return {
    class: ['assets/asset'],
    properties: {
      'asset:readonly': false,
      'jcr:created': currDate,
      'jcr:lastModified': currDate,
      name: decodeURI(name),
      'asset:size': size
    }
  }
};

MockRepository.toDateString = function (timestamp) {
  return new Date(timestamp).toISOString();
};

MockRepository.prototype.addEntity = function (path, entity, cb) {
  var parent = utils.getParentPath(path);

  this.db.insert({path: path, parent: parent, entity: entity}, function (err) {
    expect(err).toBeFalsy();
    cb();
  });
};

MockRepository.prototype.getEntity = function (path, cb) {
  var self = this;
  function getDoc(docCb) {
    if (path == '/') {
      docCb(self.root);
    } else {
      self.db.findOne({path: path}, function (err, doc) {
        expect(err).toBeFalsy();
        docCb(doc);
      });
    }
  }
  getDoc(function (doc) {
    if (doc) {
      if (doc.entity['class'] == 'assets/folder') {
        doc['entities'] = [];
        self.db.find({parent: path}, function (err, docs) {
          expect(err).toBeFalsy();
          for (var i = 0; i < docs.length; i++) {
            doc.entities.push(docs[i].entity);
          }
          cb(doc);
        });
      } else {
        cb(doc);
      }
    } else {
      cb();
    }
  });
};

function _updateRecord(path, updateFunc, cb) {
  var self = this;
  self.db.findOne({path: path}, function (err, doc) {
    expect(err).toBeFalsy();
    if (doc) {
      var newEntity = updateFunc(doc.entity);
      self.db.update({path: path}, {$set: {entity: newEntity}}, {}, function (err) {
        expect(err).toBeFalsy();
        cb();
      });
    } else {
      cb();
    }
  });
}

MockRepository.prototype.setReadOnly = function (path, readOnly, cb) {
  _updateRecord.call(this, path, function (data) {
    data.properties['asset:readonly'] = readOnly;
    return data;
  }, cb);
};

MockRepository.prototype.setCreated = function (path, created, cb) {
  _updateRecord.call(this, path, function (data) {
    data.properties['jcr:created'] = MockRepository.toDateString(created);
    return data;
  }, cb);
};

MockRepository.prototype.setLastModified = function (path, lastModified, cb) {
  _updateRecord.call(this, path, function (data) {
    data.properties['jcr:lastModified'] = MockRepository.toDateString(lastModified);
    return data;
  }, cb);
};

MockRepository.prototype.setSize = function (path, size, cb) {
  _updateRecord.call(this, path, function (data) {
    data.properties['asset:size'] = size;
    return data;
  }, cb);
};

MockRepository.prototype.delete = function (path, cb) {
  this.db.remove({path: path}, {}, function (err) {
    expect(err).toBeFalsy();
    cb();
  });
};

MockRepository.prototype.move = function (path, targetPath, cb) {
  var targetName = utils.getPathName(targetPath);
  var self = this;
  this.db.findOne({path: path}, function (err, doc) {
    expect(err).toBeFalsy();
    expect(doc).toBeTruthy();
    doc.entity.properties.name = targetName;
    self.db.update({path: path}, {$set: {path: targetPath, entity: doc.entity}}, {}, function (err) {
      expect(err).toBeFalsy();
      cb();
    });
  });
};

module.exports = MockRepository;
