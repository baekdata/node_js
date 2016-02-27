var express = require('express');
var router = express.Router();
var async = require('async');
var mysql = require('mysql');
var path = require('path');
var dbConfig = require('../config/database');
var pool = mysql.createPool(dbConfig);
var logger = require('../config/logger');
var server = 'http://ec2-54-64-102-246.ap-northeast-1.compute.amazonaws.com';
var gcm = require('node-gcm');
var gcmConfig = require('../config/gcm');
var isLoggedIn = require('../lib/common').isLoggedIn;

  /* view group list */
function viewGroupList(req, res, next) {
	  /* avoid network I/O bottleneck by using nextTick */
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
  		var selectQry = 'SELECT g.group_id, g.group_name, g.group_cover ' +
  		                'FROM groups g ' +
  		                'JOIN participate p ' +
  		                'ON (p.user_id = ? ' +
  		                'AND g.group_id = p.group_id)' +
  		                'ORDER BY g.group_id DESC';
  		connection.query(selectQry, [req.user.userId], function(err, rows, fields) {
  			if (err) {
  				logger.error(err);
					connection.release();
					return next(err);
				}
				var result = [];
				connection.beginTransaction(function(err) {
					if (err) {
						logger.error(err);
						connection.release();
						return next(err);
					}
					async.each(rows,
						function iterator(row, done) {
						  var groupList = {};
						  groupList.groupId = row.group_id;
						  groupList.groupName = row.group_name;
						  groupList.groupCover = row.group_cover;
						  result.push(groupList);
						  done();
						},
						function(err) {
							if (err) {
								return rollback(err);
							}
							commit();
							connection.release();
							res.json({
					  		"success": 1,
					  		"result": {
					  			"message": "그룹 목록 조회 완료",
					  			"groupList": result
					  		}
					  	});
						}
					); // end of async.each
				}); // end of transaction
				function rollback(err) {
					connection.rollback(function() {
						logger.error(err);
						connection.release();
						return next(err);
					});
				}
				function commit() {
					connection.commit(function(err) {
						if (err) {
							return rollback(err);
						}
					});
				}
  		}); // end of connection.query
  	}); // end of pool
	}); // end of nextTick
}

  /* create group */
function createGroup(req, res, next) {
	  /* avoid network I/O bottleneck by using nextTick */
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
  		if (err) {
  			logger.error(err);
  			connection.release();
				return next(err);
			}
  		async.waterfall([
  		  function beginTransaction(callback) {
  		  	connection.beginTransaction(function(err) {
  		  		if (err) {
							return callback(err);
						}
  		  		callback();
  		  	});
  		  },
  		  function(callback) {
  	  		var insertGroups = 'INSERT INTO groups (group_name, group_cover) ' +
  	  		                   'VALUES (?, ?)';
  	  		connection.query(insertGroups, [req.body.groupName, req.body.groupCover], function(err, result) {
  	  			if (err) {
  						return callback(err);
  					}
  					var groupId = result.insertId;
  					callback(null, groupId);
  	  		});
  		  },
  		  function(groupId, callback) {
  		  	var insertParticipate = 'INSERT INTO participate ' +
  		  	                        'VALUES (?, ?)';
  		  	connection.query(insertParticipate, [req.user.userId, groupId], function(err, result) {
  		  		if (err) {
							return callback(err);
						}
  		  		callback(null, groupId);
  		  	});
  		  },
  		  function(groupId, callback) {
  		  	var selectQry = 'SELECT group_name, group_cover ' +
  		  	                'FROM groups ' +
  		  	                'WHERE group_id = ?';
  		  	connection.query(selectQry, [groupId], function(err, rows, fields) {
  		  		if (err) {
							return callback(err);
						}
  		  		var groupInfo = {};
  		  		groupInfo.groupId = groupId;
  		  		groupInfo.groupName = rows[0].group_name;
  		  		groupInfo.groupCover = rows[0].group_cover;
  		  		callback(null, groupInfo);
  		  	});
  		  },
  		  function commit(groupInfo, callback) {
  		  	connection.commit(function(err) {
  		  		if (err) {
  		  			return callback(err);
  		  		}
  		  		connection.release();
  		  		callback(null, groupInfo);
  		  	});
  		  } // end of commit
  		],
  		function(err, groupInfo) {
  			if (err) {
  				connection.rollback(function() {
  					logger.error(err);
  					connection.release();
  					return next(err);
  				});
				}
  			res.json({
		  		"success": 1,
		  		"result": {
		  			"message": "그룹 생성 완료",
		  			"group": groupInfo
		  		}
		  	});
  		}); // end of async.waterfall
  	}); // end of connectionPool
	}); // end of nextTick
}

  /* 그룹 참여 */
function participateGroup(req, res, next) {
  var userId = req.user.userId;
  var groupId = req.params.groupId;
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
        connection.release();
        next(err);
      }
      else {
        async.waterfall([
          function beginTransaction(callback) {
            connection.beginTransaction(function(err) {
            	if (err) {
            		return callback(err);
            	}
            	callback();
            });
          },
          function(callback) {
          	var selectQry = 'SELECT group_id ' +
          	                'FROM groups ' +
          	                'WHERE group_id = ?';
          	connection.query(selectQry, [groupId], function(err, rows, fields) {
          		if (err) {
          			return callback(err);
          		}
          		if (rows.length === 0) {
          			connection.commit(function(err) {
          				if (err) {
          					return callback(err);
          				}
          				var result = {
          					"success": 0,
          					"result": {
          						"message": "유효하지 않은 그룹입니다."
          					}
          				};
          				return res.json(result);
          			});
          		}
          		else {
          			callback();
          		}
          	});
          },
          function(callback) {
            var insertQry = 'INSERT INTO participate ' +
                            'VALUES (?, ?)';
            connection.query(insertQry, [userId, groupId], function(err, result) {
            	if (err) {
            		return callback(err);
            	}
            	callback(null, groupId);
            });
          },
          function notification(groupId, callback) {             
            var selectQryNotificationUser = 
                            "SELECT gcm_id, group_name, g.group_id, user_name " +
                            "FROM participate p " +
                            "JOIN users u " + 
                            "ON u.user_id = p.user_id " + 
                            "LEFT JOIN groups g " + 
                            "on p.group_id = g.group_id " + 
                            "WHERE p.group_id = ? and notification = ? ";              
            connection.query(selectQryNotificationUser, [groupId, 1], function(err, rows, fields) {
              if (err) {
                callback(err);
              }
              else {
                if(rows.length === 0) {
                  registrationIds.push(null);
                  callback(null);
                }
                else {
                  async.each(rows,
                    function(row, cb) {
                      logger.debug('row.gcm_id', row.gcm_id);
                      logger.debug('gcm registration',registrationIds);
                      registrationIds.push(row.gcm_id);
                      cb();  
                    },
                    function(err) {
                      if(err) {
                        callback(err);
                      }
                      else {
                        logger.debug('gcm', registrationIds);
                      }
                    }
                  );
                  message.addDataWithKeyValue('groupId', groupId);
                  message.addDataWithKeyValue('groupName', rows[0].group_name);
                  callback();
                }
              }
            });
          },
          function (callback) {
            var selectQry = "SELECT user_name, email " +
                            "FROM users " +
                            "WHERE user_id = ? ";
            connection.query(selectQry, [userId], function(err, rows, fields) {
              if(err) {
                logger.debug('connection query error selectQry');
                logger.error('error');
                callback(err);
              } else {
                message.addDataWithKeyValue('userName', rows[0].user_name);
                message.addDataWithKeyValue('email', rows[0].email);
                callback();
              }
            });
          },
          function commit(callback) {
            connection.commit(function(err) {
              if (err) {
                callback(err);
              }
              else {
                callback();
              }
            });
          } // end of commit
        ],
        function(err) {
          if (err) {
            connection.rollback(function() {
              logger.error(err);
              connection.release();
              next(err);
            });
          }
          else {
            sender.send(message, registrationIds, 4, function(err, result) {
              if (err) {
                err.message = 'sender.send error';
                next(err);
              } else {
                connection.release();
                res.json({
                  "success": 1,
                  "result": {
                    "message": "그룹 참여 완료",
                    "groupId": groupId,
                    "login": 1
                  }
                });
              }
            });
          }
        }); // end of async.waterfall  
      }
    }); // end of pool
  }); // end of nextTick
}

  /* view participant */
function viewParticipant(req, res, next) {
	  /* avoid network I/O bottleneck by using nextTick */
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
			if (err) {
				logger.error(err);
				connection.release();
				return next(err);
			}
			var groupId = req.params.groupId;
			var selectQry = 'SELECT user_name, profile_photo ' +
			                'FROM participate p ' +
			                'JOIN users u ' +
			                'ON p.user_id = u.user_id ' +
			                'WHERE p.group_id = ?';
			connection.query(selectQry, [groupId], function(err, rows, fields) {
				if (err) {
					logger.error(err);
					connection.release();
					return next(err);
				}
				var result = [];
				connection.beginTransaction(function(err) {
					if (err) {
						logger.error(err);
						connection.release();
						return next(err);
					}
					async.each(rows,
						function iterator(row, done) {
						  var participant = {};
						  participant.userName = row.user_name;
						  participant.profilePhoto = row.profile_photo;
						  result.push(participant);
						  done();
						},
						function(err) {
							if (err) {
								return rollback(err);
							}
							commit();
							connection.release();
							res.json({
								"success": 1,
								"result": {
									"message": "그룹 참여자 조회",
									"group": {
										"groupId": groupId,
										"participant": result
									}
								}
							});
						}
					); // end of async.each
				}); // end of transaction
				function rollback(err) {
					connection.rollback(function() {
						logger.error(err);
						connection.release();
						return next(err);
					});
				}
				function commit() {
					connection.commit(function(err) {
						if (err) {
							return rollback(err);
						}
					});
				}
			}); // end of connection.query
		}); // end of connectionPool
	}); // end of nextTick
}

  /* 그룹 나가기 */
function exitGroup(req, res, next) {
	  /* avoid network I/O bottleneck by using nextTick */
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
  		if (err) {
  			logger.error(err);
  			connection.release();
			  return next(err);
			}
  		async.waterfall([
        function beginTransaction(outerCallback) {
          connection.beginTransaction(function(err) {
            if (err) {
              return outerCallback(err);
            }
            outerCallback();
          });
        },
  		  function(outerCallback) {
  		  	var userId = req.user.userId;
  		  	var groupId = req.params.groupId;
  		  	var deleteParticipate = 'DELETE FROM participate ' +
  		  	                        'WHERE user_id = ? and group_id = ?';
  		  	connection.query(deleteParticipate, [userId, groupId], function(err, result) {
  		  		if (err) {
  					  return outerCallback(err);
  					}
  					outerCallback(null, groupId);
  		  	});
  		  }, /* 그룹 참여자 여부 확인 */
  		  function checkTheNumberOfParticipant(groupId, outerCallback) {
  		  	var selectQry = 'SELECT user_id ' +
  		  	                'FROM participate ' +
  		  	                'WHERE group_id = ?';
  		  	connection.query(selectQry, [groupId], function(err, rows, fields) {
  		  		if (err) {
  		  			return outerCallback(err);
  		  		}
  		  		  /* 그룹에 참여자가 없는 경우 그룹 삭제 */
  		  		if (rows.length === 0) {
  		  			async.waterfall([
  		  			  function(callback) {
  		  			  	var deleteComment = 'DELETE c ' +
  		  			  	                    'FROM posts p ' +
  		  			  	                    'JOIN comments c ' +
  		  			  	                    'USING (post_id) ' +
  		  			  	                    'JOIN groups g ' +
  		  			  	                    'USING (group_id) ' +
  		  			  	                    'WHERE g.group_id = ?';
  		  			  	connection.query(deleteComment, [groupId], function(err, result) {
  		  			  		if (err) {
  		  			  			return callback(err);
  		  			  		}
  		  			  		callback();
  		  			  	});
  		  			  },
                function(callback) {
	                var deletePost = 'DELETE FROM posts ' +
	                                 'WHERE group_id = ?';
	                connection.query(deletePost, [groupId], function(err, result) {
	                	if (err) {
	                		return callback(err);
	                	}
	                	callback(null, groupId);
	                });
                },
                function(groupId, callback) {
                	var deleteGroup = 'DELETE FROM groups ' +
                	                  'WHERE group_id = ?';
                	connection.query(deleteGroup, [groupId], function(err, result) {
                		if (err) {
                			return callback(err);
                		}
                		callback();
                	});
                }
              ],
              function(err) {
  		  				if (err) {
  		  					logger.error(err);
  		  					connection.release();
  		  					return next(err);
  		  				}
  		  			}); // end of inner async.waterfall
  		  		} // end of rows.length === 0
  		  		outerCallback();
  		  	}); // end of connection.query
  		  }, // end of check the number of participant
  		  function commit(outerCallback) {
  		  	connection.commit(function(err) {
        		if (err) {
        			return outerCallback(err);
        		}
        		connection.release();
        		outerCallback();
        	});
  		  } // end of commit
  		],
  		function(err) {
  			if (err) {
					connection.rollback(function() {
						logger.error(err);
						connection.release();
						return next(err);
					});
				}
				res.json({
					"success": 1,
					"result": {
						"message": "그룹 나가기 완료"
					}
				});
  		}); // end of outer async.waterfall
  	}); // end of connectionPool
	}); // end of nextTick
}

  /* 그룹 초대 웹 페이지 */
function renderView(req, res) {
	res.render('invite', { title: 'Invite to Group', groupId: req.params.groupId, groupName: req.params.groupName, userName: req.params.userName });
}

  /* 그룹 초대 */
function inviteToGroup(req, res, next) {
	var userId = req.user.userId;
	var userName = req.user.userName;
	var groupId = req.params.groupId;
	
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
			if (err) {
				logger.error(err);
				connection.release();
				return next(err);
			}
			var selectQry = 'SELECT group_name ' +
			                'FROM groups g ' +
			                'JOIN participate p ' +
			                'ON g.group_id = p.group_id ' +
			                'WHERE g.group_id = ? and p.user_id = ?';
			connection.query(selectQry, [groupId, userId], function(err, rows, fields) {
				if (err) {
					logger.error(err);
					connection.release();
					return next(err);
				}
				var groupName = rows[0].group_name;
				connection.release();
				res.json({
					"success": 1,
					"result": {
						"message": "그룹 초대 URL 요청 완료",
						"group": {
							"inviteUrl": server + '/groupbox/' + groupId + '/' + groupName + '/' + userName + '/renderView'
						}
					}
				});
			}); // end of connection.query
		}); // end of pool
	}); // end of nextTick
}

function postCreate(req, res, next) {
  var userId = req.user.userId; 
  var groupId = req.params.group_id;
  var postContent = req.body.post_content;
   if (groupId === undefined) {
    logger.debug('Group_id undefined');
    var err = new Error('get ');
    next(err);
  } else {
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
          async.waterfall([
             function(callback) {
               var fileId = req.body.file_id;
               if (fileId === '0') {
                 var createFilePost = "Insert into posts(post_content, group_id , user_id) values (?,?,?) ";
                 connection.query(createFilePost, [postContent, groupId, userId], function(err, rows, fields) {
                   if (err) {
                     logger.error(err);
                       logger.debug('connection query error');
                       err.message = 'An unexpected error occurred. After a while tried again, please.';  
                       callback(err);
                   } else {
                     callback(null);
                   }//connection.query else
                 });//connection query(Create)
               } else {
                 var createPost = "Insert into posts(post_content, group_id , user_id, recording_file_id) values (?,?,?,?) ";
                 connection.query(createPost, [postContent, groupId, userId, fileId], function(err, rows, fields) {
                   if (err) {
                     logger.error(err);
                       logger.debug('connection query error');
                       err.message = 'An unexpected error occurred. After a while tried again, please.';  
                       callback(err);
                   } else {
                     callback(null);
                   }//connection.query else
                 });//connection query(Create)
               }
             },
             function(callback) {
               var gcmAram =  'SELECT gcm_id, group_name, g.group_id ' +
                              'FROM participate p ' +
                              'JOIN users u ' +
                              'ON u.user_id = p.user_id ' +
                              'left JOIN groups g ' +
                              'on p.group_id = g.group_id ' +
                              'WHERE p.group_id = ? and notification = 1 and p.user_id != ? ' ;
               connection.query(gcmAram, [groupId, userId], function(err, rows, fields) {
                 if(err) {
                   logger.error(err);
                   logger.debug('connection.query error');
                   err.message = 'An unexpected error occurred. After a while tried again, please.';  
                   callback(err);
                 } else {
                   if(rows.length === 0 ) {
                     registrationIds.push(null);
                     callback(null);
                   } else {
                     async.each(
                       rows,
                       function(row, cb) {
                         logger.debug('gcm registration',registrationIds);
                         registrationIds.push(row.gcm_id);
                         logger.debug('gcm registration',registrationIds);
                         logger.debug('row.gcm_id', row.gcm_id);
                         cb();
                       },
                       function(err) {
                         if(err) {
                           logger.error(err);
                           logger.debug('async.each error');
                           callback(err);
                         } else {
                           logger.debug('gcm',registrationIds);
                           logger.debug(rows[0].group_name );
                         }
                       }
                     );
                      message.addDataWithKeyValue('groupName',rows[0].group_name);
                      message.addDataWithKeyValue('groupId',rows[0].group_id);
                  //  logger.debug( 'MEssage:' ,message.addDataWithKeyValue('groupId',rows[0].group_id));
                      callback(null);
                   }
                 }
               });
             },
             function(callback) {
               var userNameSQL = "select user_name " +
                                 "from users " +
                                 "where user_id = ? ";
               connection.query(userNameSQL, [userId], function(err, rows, fields) {
                 if(err) {
                     logger.error(err);
                       logger.debug('connection query error');
                       err.message = 'An unexpected error occurred. After a while tried again, please.';  
                       next(err);
                     } else {
                       if(rows.length === 0) {
                         callback(err);
                       } else {
                         message.addDataWithKeyValue('userName', rows[0].user_name);
                    var result = {
                      "success" : 1,
                      "result" : {
                        "message" : "success post create"
                      }
                    };
                    callback(null, result);           
                 }
               }
             });
            }
          ],
            function(err, result){
              if(err) {
                connection.release();
                next(err);
              } else {
                sender.send(message, registrationIds, 4, function(err, result) {
                  if(err) {
                    err.message = 'sender.send error';
                    next(err);
                  } else {
                    logger.debug('gcm: ',registrationIds);
                    logger.debug('message: ',message);
                    logger.debug('result :',result);
                    connection.release();
                    res.json(result);
                  }
                });
              }
            }
          );
        }//connection.pool else       
      });//connection.Pool
    });//group_id else
  }
}

function postAllView (req, res, next) {
  
  var viewAll =
                "SELECT p.post_id post_id, user_name userName, post_content postContent, date_format(post_date, '%Y-%m-%d') postDate, part_id partId, replay_time replayTime, p.recording_file_id fileId, file_path filePath, comment_count commentCount, profile_photo profilePhoto, file_name fileName " +
                "FROM posts p " + 
                "JOIN users u " +
                "ON(p.user_id = u.user_id) " +
                "LEFT JOIN recording_files r " +
                "ON(p.recording_file_id = r.recording_file_id) " +
                "WHERE group_id = ? " +
                "Order by p.post_id desc limit ?,?  " ;
  
  var page = parseInt(req.body.pageNum);
  logger.debug('  page  ',  page); 
  logger.debug('pageNum ', req.body.pageNum);
  var toNumber = (page-1) * 10;
  logger.debug('toNumber', toNumber);
  if (typeof page === "undefined") {
    logger.log('info', 'page undefined');
    var error = new Error('page error');
    return next(error);
  }
  var groupId = req.params.group_id;
  if (groupId === undefined) {
    var err = new Error('groupId undefined');
    next(err);
  } else {
    process.nextTick(function() {
      pool.getConnection( function(err, connection) {
        if (err) {
          logger.error(err);
          logger.debug('connection.query error');
          err.message = 'An unexpected error occurred. After a while tried again, please.';  
          next(err);
        } else {
          connection.query(viewAll, [groupId, toNumber , 10], function(err, rows, fields){
            logger.debug(rows);
            if (err) {
              logger.error(err);
              logger.debug('connection.query error');
              err.message = 'An unexpected error occurred. After a while tried again, please.';  
              next(err);
              connection.release();
            } else {
              if (rows.length === 0) {
                 connection.release();
                 var result = {
                	 "success" : 1,
                   "result" : {
                     "post_list" : []
                   }
                 };
                 return res.json(result);
              } else {
                var psy = [];
                async.each(rows,
                  function iterator(row, done) {
                    var postList = {};
                    postList.userName = row.userName;
                    postList.postContent = row.postContent;
                    postList.postDate = row.postDate;
                    postList.partId = row.partId;
                    postList.replayTime = row.replayTime;
                    postList.fileId = row.fileId;
                    postList.filePath = row.filePath;
                    postList.commentCount = row.commentCount;
                    postList.profilePhoto = row.profilePhoto;
                    postList.fileName = row.fileName;
                    postList.post_id = row.post_id;
                    psy.push(postList);
                    done();
                  },
                  function(err) {
                    if(err) {
                      connection.release();
                      logger.error(err);
                      return next(err);
                    }
                  }
                ); // end of async.each
                res.json({
                  "success": 1,
                  "result": {
                    "post_list": psy
                  }
                }); //res.json
                connection.release();
              }//else(rows.length == 0)
            }//else(Connection err)
          });//connection query
        }//else connectionPool
      });//connection Pool
    });
  } 
}

function postNameView(req, res, next) {
  var groupId = req.params.group_id;
  var userName = req.body.user_name;
  var postViewUserName = 
   "SELECT p.post_id post_id, user_name userName, post_content postContent, date_format(post_date, '%Y-%m-%d') postDate, part_id partId, replay_time replayTime, p.recording_file_id fileId, file_path filePath, comment_count commentCount, profile_photo profilePhoto, file_name fileName " +
   "FROM posts p " +
    "LEFT JOIN users u " +
    "ON(p.user_id = u.user_id) "+
    "LEFT JOIN recording_files r " +
    "ON(p.recording_file_id =r.recording_file_id) " +
    "WHERE p.group_id = ? and u.user_name = ? ";
  
  if (groupId === undefined) {
    var err = new Error('groupId undefined');
    next(err);
  } else {
    process.nextTick(function() {
      pool.getConnection(function(err,connection) {
        if (err){
          logger.error(err);
          logger.debug('getConnection error');
          err.message = 'An unexpected error occurred. After a while tried again, please.';  
          next(err);
        } else {
          connection.query(postViewUserName, [groupId, userName], function(err, rows, fields){
            if (err) {
              logger.error(err);
              logger.debug('connection.query error');
              err.message = 'An unexpected error occurred. After a while tried again, please.';  
              next(err);
              connection.release();
            } else {
              if (rows === 0) {
              	connection.release();
              	var result = {
              		"success" : 1,
                  "result" : {
                    "post_list" : []
                  }
              	};
                return res.json(result); 
              } else {
                var psy = [];
                async.each(rows,
                  function iterator(row, done) {
                    var postList = {};
                    postList.userName = row.userName;
                    postList.postContent = row.postContent;
                    postList.postDate = row.postDate;
                    postList.partId = row.partId;
                    postList.replayTime = row.replayTime;
                    postList.fileId = row.fileId;
                    postList.filePath = row.filePath;
                    postList.commentCount = row.commentCount;
                    postList.profilePhoto = row.profilePhoto;
                    postList.fileName = row.fileName;
                    postList.postId = row.post_id;
                    psy.push(postList);
                    done();
                  },
                  function(err) {
                    if(err) {
                      connection.release();
                      logger.error(err);
                      return next(err);
                    }
                  }
                ); // end of async.each
                res.json({
                  "success": 1,
                  "result": {
                    "post_list": psy
                  }
                }); //res.json
                connection.release();
              }
            }//connection.query.else
          });//connection.query
        }//connecitionPool else
      });//connectionPool
    });
  }
}

function postPartView(req, res, next) {
  var groupId = req.params.group_id;
  var partId = req.params.part_id;
  var partView =  
  "SELECT p.post_id, user_name userName, post_content postContent, date_format(post_date, '%Y-%m-%d') postDate, part_id partId, replay_time replayTime, p.recording_file_id fileId, file_path filePath, comment_count commentCount, profile_photo profilePhoto, file_name fileName " +
  "FROM posts p " +
  "JOIN recording_files r " +
  "ON(p.recording_file_id = r.recording_file_id) " +
  "JOIN users u " +
  "ON(p.user_id = u.user_id) " +
  "WHERE p.group_id = ? and r.part_id = ? ";
  if (groupId === undefined || partId === undefined) {
    var err = new Error('groupId undefined');
    next(err);
  } else {
    process.nextTick(function() {
      pool.getConnection(function(err, connection) {
        if (err){
          logger.error(err);
          err.message = 'An unexpected error occurred. After a while tried again, please.';  
          next(err);
        } else {
          connection.query(partView,[groupId, partId],function(err, rows, fields){
            if (err) {
              logger.error(err);
              err.message = 'An unexpected error occurred. After a while tried again, please.';  
              next(err);
              connection.release();
            } else {
              if (rows.length === 0) {
                connection.release();
                var result = {
                	"success" : 1,
                  "result" : {
                    "post_list" : []
                  }	
                };
                return res.json(result);
              } else {
                var psy = [];
                async.each(rows,
                  function iterator(row, done) {
                    var postList = {};
                    postList.userName = row.userName;
                    postList.postContent = row.postContent;
                    postList.postDate = row.postDate;
                    postList.partId = row.partId;
                    postList.replayTime = row.replayTime;
                    postList.fileId = row.fileId;
                    postList.filePath = row.filePath;
                    postList.commentCount = row.commentCount;
                    postList.profilePhoto = row.profilePhoto;
                    postList.fileName = row.fileName;
                    postList.postId = row.post_id;
                    psy.push(postList);
                    done();
                  },
                  function(err) {
                    if (err) {
                      connection.release();
                      logger.error(err);
                      return next(err);
                    }
                  }
                ); // end of async.each
                res.json({
                  "success": 1,
                  "result": {
                    "post_list": psy
                  }
                }); //res.json
                connection.release();
              }
            }// end of connection.query else 
          });// end of connection.query
        }// end of connectionPool else
      });// end of connectionPool
    });// end of process.nextTick
  }// end of group_id else
}// end of partView

function postNamePartView(req, res, next) {
  var groupId = req.params.group_id;
  var partId = req.params.part_id;
  var userName = req.body.user_name;
  var postNamePart = 
  "SELECT p.post_id, user_name userName, post_content postContent, date_format(post_date, '%Y-%m-%d') postDate, part_id partId, replay_time replayTime, p.recording_file_id fileId, file_path filePath, comment_count commentCount, profile_photo profilePhoto, file_name fileName " +
  "FROM posts p " + 
  "JOIN users u " +  
  "ON(p.user_id = u.user_id) " +
  "JOIN recording_files r " +
  "ON(p.recording_file_id = r.recording_file_id) " +
  "WHERE p.group_id = ? and r.part_id = ? and u.user_name = ? ";
  if (partId === undefined) {
    var err = new Error('partId undefined');
    next(err);
  } else {
    process.nextTick(function() {
      pool.getConnection(function(err, connection) {
        if (err){
          logger.error(err);
          err.message = 'An unexpected error occurred. After a while tried again, please.';  
          next(err);
        } else {
          connection.query(postNamePart, [groupId, partId, userName], function(err, rows, fields){
            if (err) {
            	connection.release();
              logger.error(err);
              err.message = 'An unexpected error occurred. After a while tried again, please.';  
              next(err);
            } else {
              if (rows.length === 0) {
                connection.release();
                var result = {
                	"success" : 1,
                  "result" : {
                    "post_list" : []
                  }
                };
                return res.json(result);  
              } else {
                var psy = [];
                async.each(rows,
                  function iterator(row, done) {
                    var postList = {};
                    postList.userName = row.userName;
                    postList.postContent = row.postContent;
                    postList.postDate = row.postDate;
                    postList.partId = row.partId;
                    postList.replayTime = row.replayTime;
                    postList.fileId = row.fileId;
                    postList.filePath = row.filePath;
                    postList.commentCount = row.commentCount;
                    postList.profilePhoto = row.profilePhoto;
                    postList.fileName = row.fileName;
                    postList.postId = row.post_id;
                    psy.push(postList);
                    done();
                  },
                  function(err) {
                    if (err) {
                      connection.release();
                      logger.error(err);
                      return next(err);
                    }
                  }
                ); // end of async.each
                res.json({
                  "success": 1,
                  "result": {
                    "post_list": psy
                  }
                }); //res.json
                connection.release();
              }
            }
          });//conneciont.query
        }
      });//connectionPool
    });//connectionPool
  }//Part_id else
}

router.route('/')
  .get(viewGroupList) // 그룹 목록 조회
  .post(createGroup); // 그룹 생성
router.get('/:groupId/:groupName/:userName/renderView', renderView); // 그룹 초대 웹 페이지
router.get('/:groupId/invite', inviteToGroup); // 그룹 초대
router.post('/:groupId/participate', isLoggedIn, participateGroup); // 그룹 참여
router.get('/:groupId/participant', viewParticipant); // 그룹 멤버 조회
router.delete('/:groupId', exitGroup); // 그룹 나가기

router.post('/:group_id', postCreate); 
router.post('/page/:group_id', postAllView); 
router.post('/:group_id/users', postNameView);
router.get('/:group_id/part/:part_id', postPartView);
router.post('/:group_id/part/:part_id/users', postNamePartView);

module.exports = router;