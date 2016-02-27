var express = require('express');
var router = express.Router();
var logger = require('../config/logger');
var path = require('path');
var mysql = require('mysql');
var dbConfig = require('../config/database');
var http = require('http');
var async = require('async');
var fs = require('fs');
var fstools = require('fs-tools');
var mime = require('mime');
var formidable = require('formidable');
var pool = mysql.createPool(dbConfig);
var s3 = require('s3');
var s3Config = require('../config/s3');

function commentDelete(req, res, next) {
  var commentId = req.params.comment_id;
  var userId = req.user.userId;
  
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
            logger.debug('beginTransaction Err');
            logger.error(err);
            err.message = 'An unexpected error occurred. After a while tried again, please.';  
            connection.release();
            next(err);
          } else {
            async.waterfall([
              function commentVerification(callback) {
                logger.debug('commentId', commentId);
                var select = "SELECT comment_id, comment_content, comment_date, user_id, post_id, comment_file_path " +
                             "FROM comments " +
                             "WHERE comment_id = ? ";
                connection.query(select, [commentId], function(err, rows, fields) {
                  if (err) {
                    logger.error(err);
                    logger.debug('connection.query error');
                    err.message = 'An unexpected error occurred. After a while tried again, please.';  
                    callback(err);
                  } else {
                    var postId = rows[0].post_id;
                    var filePath = path.basename(rows[0].comment_file_path);
                    var postUserId = rows[0].user_id;
                    
                    if (postUserId === userId) {
                      callback(null, postId, filePath);
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
                              "message": "Not by the creator of the comment"
                            }
                        	};
                          return res.json(result);
                        }
                      });
                    }
                  }
                }); 
              },
              function commentDelete(postId, filePath, callback) {
                var deleteComment = "DELETE from comments " +
                                    "WHERE comment_id = ? ";
                connection.query(deleteComment, [commentId], function(err, result) {
                  if (err) {
                    logger.error(err);
                    err.message = 'An unexpected error occurred. After a while tried again, please.';  
                    callback(err);
                  } else {
                    callback(null, postId, filePath);
                  }
                });//connection.query.function
              },
              function numberOfComment(postId, filePath, callback) {
                var count = "UPDATE posts " +
                            "SET comment_count = (SELECT count(*) " +
                            "                     FROM comments " +
                            "                     WHERE post_id = ?) " +
                            "WHERE post_id = ? ";
                connection.query(count, [postId, postId], function(err, rows, fields) {
                  if (err) {
                    logger.error(err);
                    err.message = 'An unexpected error occurred. After a while tried again, please.';  
                    callback(err);
                  } else {
                    callback(null, filePath);
                  }
                });
              },
              // commit
              function fileDelete(filePath, callback){
                var client = s3.createClient({
                  s3Options : { 
                    accessKeyId : s3Config.key,
                    secretAccessKey : s3Config.secret,
                    region : s3Config.region
                  }
                });
                var s3Params = {
                  Bucket : s3Config.bucket,
                  Delete : {
                    Objects : [
                      { Key : s3Config.recordDir + "/" + filePath }
                    ]
                  }
                };
                client.deleteObjects(s3Params)
                      .on('error', function(err) {
                        logger.error(err);
                        callback(err);
                      })
                      .on('end', function() {
                        callback();
                      });
              },
              function commit(callback){
               connection.commit(function(err) {
                  if (err) {
                    err.message = 'commit Error';
                    callback(err);
                  } else {
                    connection.release();
                    callback();
                  }
                });
              },
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
                    "message" : "You had to delete comment in success"
                  }
                };
                res.json(result);
              }// end of rollback else 
            });//end of waterfall
          }//end of beginTransaction else
        });//end of beginTransaction
      } //end of pool.getConnection else
    }); //end ofpool.getconnetion
  });//end of process.nextTick
}//end of commentDelete

router.delete('/:comment_id', commentDelete);

module.exports = router;