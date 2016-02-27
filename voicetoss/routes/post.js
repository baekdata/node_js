var express = require('express');
var router = express.Router();
var logger = require('../config/logger');
var path = require('path');
var mysql = require('mysql');
var dbConfig = require('../config/database');
var async = require('async');
var fs = require('fs');
var fstools = require('fs-tools');
var mime = require('mime');
var formidable = require('formidable');
var pool = mysql.createPool(dbConfig);
var s3 = require('s3');
var s3Config = require('../config/s3');
var gcm = require('node-gcm');
var gcmConfig = require('../config/gcm');

function postDelete(req, res, next) {
  var userId = req.user.userId;
  var postId = req.params.post_id;

 process.nextTick(function() {
   pool.getConnection(function(err, connection)  {
     if(err) {
       logger.error(err);
       logger.debug('getConnection error');
       err.message = 'An unexpected error occurred. After a while tried again, please.';  
       next(err);
    } else {
      connection.beginTransaction(function(err) {
         if (err) {
           logger.error(err);
           logger.debug('beginTramsacton error');
           err.message = 'An unexpected error occurred. After a while tried again, please.';  
           next(err);
         } else {
           logger.debug('beginTransaction success');
           async.waterfall([
             function (callback) {
               var postUserId = "SELECT user_id " +
                                "FROM posts " +
                                "WHERE post_id = ?"; 
               connection.query(postUserId, [postId], function(err, rows, fields) {
                 if (err) {
                   logger.error(err);
                   logger.debug('connection.query error');
                   err.message = 'An unexpected error occurred. After a while tried again, please.';  
                   callback(err);
                 } else {
                   if (rows.length === 0) {
                     err.message = 'userId undefined';
                     callback(err); 
                   } else {
                     var postUserId = rows[0].user_id;
                     if (postUserId === userId) {
                       callback();
                     }
                     else {
                       connection.commit(function(err) { 
                         if (err) {
                           callback(err);
                         } else {
                        	 connection.release();
                        	 var result = {
                        		 "success": 0,
                             "result": {
                               "message": "Not by the creator of the postings"
                             } 
                        	 };
                           return res.json(result);
                         }
                       });  
                     }
                   }
                 }
               }); //connection.query select
             },
             function (callback) {
               var selectFilePath = "SELECT comment_file_path " +
                                    "FROM comments " +
                                    "WHERE comment_file_path != 'NULL' and post_id = ?";
               connection.query(selectFilePath, [postId], function(err, rows, fields) {
                 if (err) {
                   logger.error(err);
                   err.message = 'An unexpected error occurred. After a while tried again, please.';  
                   callback(err);
                 } else {
                   var client = s3.createClient({
                     s3Options : {
                       accessKeyId: s3Config.key,
                       secretAccessKey: s3Config.secret,
                       region: s3Config.region
                     }
                   });
                   var obj = [];
                   async.each(rows,
                     function iterator(row, done) {
                     obj.push({ Key: s3Config.recordDir + "/" + path.basename(row.comment_file_path) });
                     done();
                     },
                     function(err) {
                       if (err) {
                         return callback(err);
                       }
                     }); // end of async.each
                     var s3Params = {
                       Bucket : s3Config.bucket,
                       Delete : {
                         Objects : obj
                       }
                     };
                     client.deleteObjects(s3Params)
                       .on('error', function(err) {
                         callback(err);
                       })
                       .on('end', function() {
                         callback();
                       });
                 }
               });
             },
             function (callback) {
               var commentDelete = "DELETE FROM comments " +
                                   "WHERE post_id = ?";
              connection.query(commentDelete, [postId], function(err, info) {
                if (err) {
                  logger.debug('connection.query error');
                  err.message = 'An unexpected error occurred. After a while tried again, please.';  
                  callback(err);
                } else {
                  callback();
                }//connection else
              }); 
            },//function callback
            function (callback) {
              var deletePost = "DELETE from posts " +
                               "WHERE post_id = ?";
              connection.query(deletePost, [postId], function(err, result) {
                if (err) {
                  logger.debug('connection.query error');
                  err.message = 'An unexpected error occurred. After a while tried again, please.';  
                  callback(err);
                } else {
                  callback();   
                }
              });//connection.query
            },
            function commit(callback){
              connection.commit(function(err) {
                  if (err) {
                    callback(err);
                  } else {
                    callback();
                  }
                } //end of function(err)
              ); // end of connection.commit
            } // function commit
           ],
           function(err) {
             if (err) {
               connection.rollback(function() {
                 logger.error(err);
                 connection.release();
                 next(err);
               });
             } else {
               var result = {
                 "success" : 1,
                 "result" : {
                   "message" : "You had to delete postings in success"
                 }
               };
               connection.release();
               res.json(result);
             } // end of function rollback(err);
           });// end of waterfall
         }// end of pool.beginConnection else
      });// end of pool.beginConnection
    } // end of pool.getConnection else
   });// end of pool.getConnection
 }); // end of process.Nextick
}// end of postDelete

function postEdit(req, res, next) {
  var postId = req.params.post_id;
  var userId = req.user.userId;
  var fileId = req.body.file_id;
  var postContent = req.body.post_content;
  
  process.nextTick(function() {
    pool.getConnection(function(err, connection) {
      if (err) {
        logger.error(err);
        logger.debug('connection.query error');
        err.message = 'An unexpected error occurred. After a while tried again, please.';  
        next(err);
      } else {
        connection.beginTransaction(function(err) { 
          if (err) {
            logger.error(err);
            logger.debug('beginTransaction error');
            err.message = 'An unexpected error occurred. After a while tried again, please.';
            next(err);
          } else {
            async.waterfall([
              function (callback) {
                var postUserId = "SELECT user_id " +
                                 "FROM posts " +
                                 "WHERE post_id = ?";
                connection.query(postUserId, [postId], function(err, rows, fields){
                  if (err) {
                    callback(err);
                  }
                  else {
                    if (rows === 0) {
                      logger.debug(' rows === 0 ');
                      callback(err);
                    } else {
                      var postUserId = rows[0].user_id;
                      if (postUserId === userId) {
                        callback();
                      }
                      else {
                        connection.commit(function(err) { 
                          if (err) {
                            callback(err);
                          } else {
                         	 connection.release();
                         	 var result = {
                         		 "success": 0,
                             "result": {
                               "message": "Not by the creator of the postings "
                             } 
                         	 };
                           return res.json(result);
                          }
                        });
                      }
                    } //end of (rows===0) else
                  } // end of connection.query else
                });//end of connection.query
              },// end of userVerification 
              function (callback) {
                if (fileId === '0') {
                  var editPost = "UPDATE posts " + 
                                 "SET post_content = ?, recording_file_id = ? " +
                                 "WHERE post_id = ?";
                  connection.query(editPost, [postContent, null, postId], function(err, info) {
                    if (err) {
                      callback(err);
                    } else {
                      var result = {
                        "success" : 1,
                        "result" : {
                          "message" : "Postings had editorial success"
                        }
                      };
                      callback(null, result);
                    }
                  });
                } else {
                  var editPost2 = "UPDATE posts " + 
                                  "SET post_content = ? , recording_file_id = ? " +
                                  "WHERE post_id = ?";
                  connection.query(editPost2, [postContent, fileId, postId], function(err, info) {
                    if (err) {
                      callback(err);
                    } else {
                      var result = {
                        "success" : 1,
                        "result" : {
                          "message" : "Postings had editorial success"
                        }
                      };
                      callback(null, result);
                    }
                  });
                }
              },
              function commit(result, callback) {
                connection.commit(function(err) { 
                    if (err) {
                      callback(err);
                    } else {
                      callback(null, result);
                    }
                  }
                );
              }
            ],
            function(err, result) {
              if (err) {
                connection.rollback(function() {
                  logger.error(err);
                  connection.release();
                  next(err);
                });
              } else {
               connection.release();
               res.json(result);
              }
            });//end of waterfall
          }
        });
      }// end of pool.getConnection else
    }); // end of pool.getConnection
  }); // end of process.nextTick
}// end of postEdit

function postView(req, res, next) {
  var detailComment = "SELECT post_id , comment_id, comment_content, date_format(comment_date, '%h:%i%p %b %e') comment_date, comment_replay_time, comment_file_path, user_name, profile_photo " +
                      "FROM comments c " +
                      "Join users u " +
                      "on(c.user_id =u.user_id) " +
                      "WHERE post_id = ? " +
                      "order by comment_id " ;
  var detailPost = "SELECT user_name, post_content , date_format(post_date, '%Y-%m-%d') post_date , part_id, replay_time, p.recording_file_id file_id, file_path , comment_count , profile_photo, file_name, p.group_id group_id " +
                   "FROM posts p " +
                   "LEFT JOIN recording_files r " +
                   "ON(p.recording_file_id = r.recording_file_id) " +
                   "JOIN users u " +
                   "ON(p.user_id = u.user_id) " +
                   "WHERE p.post_id = ? ";
  
  process.nextTick(function() {
    pool.getConnection(function(err, connection) {
      if(err) {
        logger.error(err);
        err.message = 'An unexpected error occurred. After a while tried again, please.'; 
        next(err);
      } else {
        connection.beginTransaction(function(err) {
          if(err) {
            logger.error(err);
            err.message = 'An unexpected error occurred. After a while tried again, please.';
            connection.release();
            next(err);
          } else {
            async.waterfall([ 
              function commentDetail(callback) { 
                var postId = req.params.post_id;
                logger.debug('postId', postId);
                connection.query(detailComment, [postId], function(err, rows, fields) {
                  if (err) {
                    logger.error(err);
                    callback(err);
                  } else {
                    var comment = [];
                    if (rows === 0 ) {
                      callback(null,comment, postId);
                    } else {
                      async.each(rows,
                        function iterator(row, done) {
                          var commentlist = {};
                          commentlist.post = row.post_id;
                          commentlist.commentId = row.comment_id;
                          commentlist.commentContent = row.comment_content;
                          commentlist.commentDate = row.comment_date;
                          commentlist.commentTime = row.comment_replay_time;
                          commentlist.commentfilePath = row.comment_file_path;
                          commentlist.replyName = row.user_name;
                          commentlist.profilePhoto = row.profile_photo;
                          comment.push(commentlist);
                          done();
                      },
                      function(err) {
                        if(err) {
                          logger.error(err);
                          callback(err);
                        }
                      });
                      callback(null, comment, postId);
                    }
                  }
                }
              );
            },
            function postDetail(comment, postId, callback) {
              logger.debug('postId', postId);
              connection.query(detailPost, [postId], function(err, rows, fields) {
                logger.debug(rows);
                  if(err) {
                    logger.error(err);
                    logger.debug('connection.query error');
                    callback(err);
                    connection.release();
                  } else {
                    if(rows.length === 0){
                      logger.debug('rows.length err');
                      callback(null);   
                    } else {
                      var result = {
                        "success" : 1,
                        "result" : {
                          "userName" : rows[0].user_name,
                          "postContent" : rows[0].post_content,
                          "postDate": rows[0].post_date,
                          "partId" : rows[0].part_id,
                          "replayTime" : rows[0].replay_time,
                          "filePath" : rows[0].file_path,
                          "profilePhoto": rows[0].profile_photo,
                          "fileId" : rows[0].file_id,
                          "fileName": rows[0].file_name,
                          "groupId" : rows[0].group_id,
                          "commentCount": rows[0].comment_count,
                          "commentList" : comment 
                        }
                      };
                      callback(null, result);
                    }
                  }
                });//connection.query
              },
              function commit(result, callback) {
                connection.commit(function(err) {
                   if (err) {
                     callback(err);
                   } else {
                     callback(null, result);
                   }
                 }
                );
              }
            ],
            function(err, result) {
              if(err) {
                connection.rollback(function() {
              	  logger.error(err);
                  connection.release();
                  next(err);
                });
              } else {
              	connection.release();
                res.json(result);
              }    
            }); //end of waterfall  
          }
        });
      } // end of pool.getConnection else
    }); //end of poolgetConnection
  }); // end of nextTick
} // end of postView

function commentCreate(req, res, next) {
  var userId = req.user.userId;
  var postId = req.params.post_id;
  var content = req.body.comment_content;
  
  var commentInsert = "INSERT INTO comments (comment_content, post_id, user_id) " +
                      "VALUES (?, ?, ?) ";
  
  var commentCount = "UPDATE posts " +
                      "SET comment_count = (SELECT count(*) " +
                      "                     FROM comments " +
                      "                     WHERE post_id = ?) " +
                      "WHERE post_id = ? ";
 
  var notification = "select gcm_id, group_name, u.user_id, user_name, notification " +
                      "from posts p " +
                      "join users u " +
                      "on(p.user_id = u.user_id) " +
                      "join groups g " +
                      "on(p.group_id = g.group_id) " +
                      "where p.post_id = ? and notification = 1 and p.user_id != ?";
                      
  var message = new gcm.Message();
  message.collapseKey = 'demo';
  message.delayWhileIdle = true;
  message.timeToLive = 3;
  var sender = new gcm.Sender(gcmConfig.apikey);
  var registrationIds = [];
  
  process.nextTick(function() {
    pool.getConnection(function(err, connection) {
      if (err) {
        logger.error(err);
        logger.debug('getconnection error');
        err.message = 'An unexpected error occurred. After a while tried again, please.';  
        next(err);
      } else {
        connection.beginTransaction(function(err) {
          if (err) {
            logger.error(err);
            logger.debug('beginTransaction');
            err.message = 'An unexpected error occurred. After a while tried again, please.';  
            connection.release();
            next(err);
          } else {
            async.waterfall([
              function createComment(callback) {
                connection.query(commentInsert, [content, postId, userId], function(err, info) {
                  if (err){
                    logger.error(err);
                    logger.debug('connection query error');
                    err.message = 'An unexpected error occurred. After a while tried again, please.';  
                    callback(err);
                  } else {
                    callback(null);
                  }
                });
              },
              function numberOfComment(callback) {
                connection.query(commentCount, [postId, postId], function( err, info ) {
                  if (err) {
                    logger.error(err);
                    logger.debug('connection query error');
                    err.message = 'An unexpected error occurred. After a while tried again, please.';  
                    callback(err);
                  } else {
                    callback(null);
                  }
                });//connection.query
              },
              function (callback) {
                connection.query(notification, [postId, userId], function(err, rows, fields) {
                  if (err) {
                    logger.error(err);
                    logger.debug('connection.query error');
                    err.message = 'An unexpected error occurred. After a while tried again, please.';  
                    callback(err);
                  } else {
                    if (rows.length === 0) {
                      registrationIds.push(null);
                      callback();
                    } else {
                      async.each(
                        rows,
                        function(row, cb) {
                          registrationIds.push(row.gcm_id);
                          logger.debug('gcm registration',registrationIds);
                          logger.debug('row.gcm_id', row.gcm_id);
                          cb();
                        },
                        function(err) {
                          if(err) {
                            err.message = 'async.each error';
                            callback(err);
                          } else {
                            logger.debug('gcm',registrationIds);
                            logger.debug(rows[0].group_name );
                          }
                        }
                      );
                      message.addDataWithKeyValue('groupName',rows[0].group_name);
                      message.addDataWithKeyValue('postId',postId);
                      callback();
                    }
                  }
                });
              },
              function commit(callback){
                connection.commit(function(err) {
                  if (err) {
                    callback(err);
                  } else {
                    callback();
                  }
                });
              }
            ],
            function(err, result) { 
              if (err) {
               connection.rollback(function() {
                  logger.debug('err rollback err');
                  connection.release();
                  next(err);
               });
              } else {
                sender.send(message, registrationIds, 4, function(err, result) {
                  if(err) {
                    connection.release();
                    err.message = 'sender.send error';
                    next(err);
                  } else {
                    logger.debug('gcm: ',registrationIds);
                    logger.debug('message: ',message);
                    logger.debug('result :',result);
                    connection.release();
                    res.json({
                      "success" : 1,
                      "result" : {
                        "message" : 'Comments had generated success'
                      }
                    });
                  }
                });
              }
            });// end of waterfall
          }//end of beginTransaction else 
        });//end of beginTransaction 
      }// end of poolgetConnection else
    }); // end of poolgetConnection
  }); // end of nextTick
}// end of commentCreate

function commentRecordCreate(req, res, next) {
  var userId = req.user.userId;
  var postId = req.params.post_id;
  
  var insertRecordfile = "INSERT INTO comments(post_id, user_id, comment_file_path, comment_replay_time) " +
                         "VALUES (?,?,?,?) ";
  var commentCount =   "UPDATE posts " +
                       "SET comment_count = (SELECT count(*) " +
                       "                     FROM comments " +
                       "                     WHERE post_id = ?) " +
                       "WHERE post_id = ? ";
  
  var notification = "select gcm_id, group_name, u.user_id, user_name, notification " +
                      "from posts p " +
                      "join users u " +
                      "on(p.user_id = u.user_id) " +
                      "join groups g " +
                      "on(p.group_id = g.group_id) " +
                      "where p.post_id = ? and notification = 1 and p.user_id != ? ";
  
  
  var message = new gcm.Message();
  message.collapseKey = 'demo';
  message.delayWhileIdle = true;
  message.timeToLive = 3;
  var sender = new gcm.Sender(gcmConfig.apikey);
  var registrationIds = [];
  process.nextTick(function() {
   pool.getConnection(function(err, connection) {
     if(err) {
       logger.error(err);
       logger.debug('getConnection error');
       err.message = 'An unexpected error occurred. After a while tried again, please.';  
       next(err);
     } else {
       connection.beginTransaction(function(err) {
         if(err) {
           logger.error(err);
           logger.debug('beginTransaction error');
           err.message = 'An unexpected error occurred. After a while tried again, please.';  
           connection.release();
           next(err);
         } else {
           async.waterfall([
             function fileUpload(callback) {
               var form = new formidable.IncomingForm();
               form.uploadDir = path.normalize(__dirname + "/../uploads/");
               form.keepExtensions = true;
               form.multiples = true;
                     

               form.parse(req, function(err, fields, files) {    
                 var client = s3.createClient({
                   s3Options : {
                     accessKeyId : s3Config.key,
                     secretAccessKey : s3Config.secret,
                     region : s3Config.region
                   }
                 });
                 var realFilePath = files.recordFile.path;
                         var commentReplay = fields.commentTime;
                                  logger.debug('commentReplay', commentReplay); 
                  var realFileName = path.basename(realFilePath);
                 var params = {
                   localFile : realFilePath,
                   s3Params : {
                     Bucket: s3Config.bucket,
                     Key : s3Config.recordDir + "/" + realFileName,
                     ACL : s3Config.ACL
                   }
                 };
                 var s3Url = s3.getPublicUrl(params.s3Params.Bucket, params.s3Params.Key, s3Config.region);
                 logger.debug(s3Url);
                 var uploader = client.uploadFile(params);
                 uploader.on('error', function(err) {
                   logger.error(err);
                   callback(err);
                 });
                 uploader.on('end', function(err) {
                   callback(null, s3Url, commentReplay);
                 });
               });
            },//end of fileupload
            function createComment(s3Url,commentReplay, callback) {
              connection.query(insertRecordfile, [postId, userId, s3Url, commentReplay], function(err, info) {
                if (err) {
                  logger.error(err);
                  err.message = 'An unexpected error occurred. After a while tried again, please.';  
                  callback(err);
                } else {
                  callback();
                }
              });//connection.query insertRecordfile
            },
            function numberOfComment(callback) {
              connection.query(commentCount, [postId, postId], function(err, info) {
                if (err) {
                  logger.error(err);
                  err.message = 'An unexpected error occurred. After a while tried again, please.';  
                  callback(err);
                } else {
                  callback();
                }
              });
            },
            function (callback) {
              connection.query(notification, [postId, userId], function(err, rows, fields) {
                if (err) {
                  logger.error(err);
                  err.message = 'An unexpected error occurred. After a while tried again, please.';  
                  callback(err);
                } else {
                  if(rows.length === 0) {
                    registrationIds.push(null);
                    callback(null);
                  } else {
                    async.each(rows,
                      function(row, cb) {
                        registrationIds.push(row.gcm_id);
                        logger.debug('gcm registration',registrationIds);
                        logger.debug('row.gcm_id', row.gcm_id);
                        cb();
                      },
                      function(err) {
                        if (err) {
                          err.message = 'async.each error';
                          next(err);
                        } else {
                          logger.debug('gcm',registrationIds);
                          logger.debug(rows[0].group_name );
                        }
                      }
                    );
                    message.addDataWithKeyValue('groupName',rows[0].group_name);
                    message.addDataWithKeyValue('postId',postId);
                    callback(null);
                  }
                }
              });
            },
            //commit
            function commit(callback) {
              connection.commit(function(err) {
                  if (err) {
                    callback(err);
                  } else {
                    callback(null);
                  }
               });
             }
          ],
          //rollback
          function(err, result) {
            if (err) {
              connection.rollback(function() {
                logger.debug('err rollback err');
                connection.release();
                next(err);
              });
            } else {
              sender.send(message, registrationIds, 4, function(err, result) {
                if (err) {
                  err.message = 'sender.send error';
                  next(err);
                } else {
                  logger.debug('gcm: ',registrationIds);
                  logger.debug('message: ',message);
                  logger.debug('result :',result);
                  connection.release();
                  res.json({
                    "success": 1,
                    "result": {
                      "message": 'Comments had generated success'
                    }
                  });
                }
              });
            }// end of rollback else
          });// end of waterfall
        } // end of connection.BeginTransction else
      }); // end of connectionBeginTransaction
     }// end of pool.getConnection else
   }); // end of pool.getConnection
  }); // end of nextTick
}// commentRecordCreate

router.route('/:post_id')
  .get(postView)
  .post(commentCreate)
  .put(postEdit)
  .delete(postDelete);

router.post('/:post_id/record', commentRecordCreate); 

module.exports = router;