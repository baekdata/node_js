var express = require('express');
var router = express.Router();
var async = require('async');
var mysql = require('mysql');
var fs = require('fs');
var path = require('path');
var request = require('request');
var fstools = require('fs-tools');
var passport = require('passport');
var bcrypt = require('bcrypt-nodejs');
var formidable = require('formidable');
var dbConfig = require('../config/database');
var pool = mysql.createPool(dbConfig);
var logger = require('../config/logger');
var server = 'http://ec2-54-64-102-246.ap-northeast-1.compute.amazonaws.com';
var s3 = require('s3');
var s3Config = require('../config/s3');
var isLoggedIn = require('../lib/common').isLoggedIn;

  /* 회원가입 인증 */
function authenticateLocalSignup(req, res, next) {
  passport.authenticate('local-signup', function(err, user, info) {
    if (err) {
      logger.error(err);
      err.message = '회원가입 인증 오류';
      return next(err);
    }
    var error = {
    	"success": 0,
    	"result": {
    		"message": '회원가입 인증 오류'
    	}
    };
    if (!user) {
      logger.debug("passport.authenticate('local-signup') ====> failed!!! ", info);
      return res.json(error);
      //return next({ message : info });
    }
    req.logIn(user, function(err) {
      if (err) {
      	logger.error(err);
      	return res.json(error);
      	/*
        logger.error(err);
        err.message = '로그인 인증 오류';
        return next(err);
        */
      }
      logger.debug("passport.authenticate('local-signup') ====> success!!!");
      var result = {
      	"success": 1,
      	"result": {
      		"message": "signup success",
      		"user": {
      			"userId": user.userId,
        		"email": user.email,
        		"userName": user.userName
      		}
      	}
      };
      res.json(result);
    });
  })(req, res, next);
}

  /* 회원 탈퇴 */
function deleteUser(req, res, next) {
	  /* avoid network I/O bottleneck by using nextTick */
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
			if (err) {
				logger.error(err);
				connection.release();
				err.message = '회원 탈퇴를 처리하는 과정에서 오류가 발생하였습니다.';
				return next(err);
			}
			var userId = req.user.userId;
			var client = s3.createClient({
	  		s3Options: {
	  			accessKeyId: s3Config.key,
	  			secretAccessKey: s3Config.secret,
	  			region: s3Config.region
	  		}
	  	});
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
			  	var selectComment = 'SELECT comment_file_path ' +
			  	                    'FROM comments ' +
			  	                    'WHERE user_id = ?';
			  	connection.query(selectComment, [userId], function(err, rows, fields) {
			  		if (err) {
			  			return callback(err);
			  		}
			  		/* 음성 댓글 파일이 있으면 삭제 */
			  		if (rows.length) {
				  		var obj = [];
				  		async.each(rows,
				  			function iterator(row, done) {
				  			  obj.push({ Key: s3Config.recordDir + '/' + path.basename(row.comment_file_path) });
				  			  done();
				  		  },
				  		  function(err) {
				  			  if (err) {
				  			  	return callback(err);
				  		  	}
				  			  var s3Params = {
				  			 	  Bucket: s3Config.bucket,
				  			 	  Delete: {
				  			 		  Objects: obj
				  			 	  }
				  		    };
				  			  client.deleteObjects(s3Params)
				  			    .on('error', function(err) {
				  				    if (err) {
				  					    logger.error(err);
					  				    connection.release();
					  				    return next(err);
				  				    }
				  			    })
				  			    .on('end', function() {
				  				    callback();
				  			    });
				  		  }
				  		); // end of async.each
			  		}
			  		/* 음성 댓글 파일이 없는 경우 */
			  		else {
			  			callback();
			  		}
			  	});
			  },
			  function(callback) {
			  	var selectRecordingFiles = 'SELECT file_path ' +
			  	                           'FROM recording_files ' +
			  	                           'WHERE user_id = ?';
			  	connection.query(selectRecordingFiles, [userId], function(err, rows, fields) {
			  		if (err) {
			  			return callback(err);
			  		}
			  		/* 녹음 파일이 있으면 삭제 */
			  		if (rows.length) {
			  			var obj = [];
				  		async.each(rows,
				  			function iterator(row, done) {
				  			  obj.push({ Key: s3Config.myboxDir + path.basename(row.file_path) });
				  			  done();
				  		  },
				  		  function(err) {
				  			  if (err) {
				  				  return callback(err);
				  			  }
				  			  var s3Params = {
				  				  Bucket: s3Config.bucket,
				  				  Delete: {
				  					  Objects: obj
				  				  }
				  			  };
				  			  client.deleteObjects(s3Params)
				  			    .on('error', function(err) {
				  				    if (err) {
				  					    logger.error(err);
					  				    connection.release();
					  				    return next(err);
				  				    }
				  			    })
				  			    .on('end', function() {
				  				    callback();
				  			    });
				  		  }
				  		); // end of async.each
			  		}
			  		/* 녹음 파일이 없는 경우 */
			  		else {
			  			callback();
			  		}
			  	});
			  },
			  function(callback) {
			  	var selectProfilePhoto = 'SELECT profile_photo ' +
			  	                         'FROM users ' +
			  	                         'WHERE user_id = ?';
			  	connection.query(selectProfilePhoto, [userId], function(err, rows, fields) {
			  		if (err) {
			  			return callback(err);
			  		}
			  		var currentPhoto = path.basename(rows[0].profile_photo);
		  		    /* 현재 이미지가 default 사진이 아닌 경우 삭제 */
		  		  if (currentPhoto !== 'default.png') {
		  		  	var obj = [];
				  		async.each(rows,
				  			function iterator(row, done) {
				  			  obj.push({ Key: s3Config.imageDir + path.basename(row.profile_photo) });
				  			  done();
				  		  },
				  		  function(err) {
				  			  if (err) {
				  				  return callback(err);
				  			  }
				  			  var s3Params = {
				  				  Bucket: s3Config.bucket,
				  				  Delete: {
				  					  Objects: obj
				  				  }
				  			  };
				  			  client.deleteObjects(s3Params)
				  			    .on('error', function(err) {
				  				    if (err) {
				  					    logger.error(err);
					  				    connection.release();
					  				    return next(err);
				  				    }
				  			    })
				  			    .on('end', function() {
				  				    callback();
				  			    });
				  		  }
				  		); // end of async.each
		  		  }
		  		  /* 현재 이미지가 default 사진인 경우 */
		  		  else {
		  		  	callback();
		  		  }
			  	});
			  },
			  function(callback) {
			  	var deleteComment = 'DELETE FROM comments ' +
			  	                    'WHERE user_id = ?';
			  	connection.query(deleteComment, [userId], function(err, result) {
			  		if (err) {
			  			return callback(err);
			  		}
			  		callback();
			  	});
			  },
			  function(callback) {
			  	var deletePost = 'DELETE FROM posts ' +
			  	                 'WHERE user_id = ?';
			  	connection.query(deletePost, [userId], function(err, result) {
			  		if (err) {
			  			return callback(err);
			  		}
			  		callback();
			  	});
			  },
			  function(callback) {
			  	var deleteParticipate = 'DELETE FROM participate ' +
			  	                        'WHERE user_id = ?';
			  	connection.query(deleteParticipate, [userId], function(err, connection) {
			  		if (err) {
			  			return callback(err);
			  		}
			  		callback();
			  	});
			  },
			  function(callback) {
			  	var deleteMyBoxFiles = 'DELETE FROM mybox_files ' +
			  	                       'WHERE user_id = ?';
			  	connection.query(deleteMyBoxFiles, [userId], function(err, result) {
			  		if (err) {
			  			return callback(err);
			  		}
			  		callback();
			  	});
			  },
			  function(callback) {
			  	var deleteRecordingFiles = 'DELETE FROM recording_files	' +
			  	                           'WHERE user_id = ?';
			  	connection.query(deleteRecordingFiles, [userId], function(err, result) {
			  		if (err) {
			  			return callback(err);
			  		}
			  		callback();
			  	});
			  },
			  function(callback) {
			  	var deleteUser = 'DELETE FROM users ' +
			  	                 'WHERE user_id = ?';
			  	connection.query(deleteUser, [userId], function(err, result) {
			  		if (err) {
			  			return callback(err);
			  		}
			  		callback();
			  	});
			  },
			  function commit(callback) {
			  	connection.commit(function(err) {
			  		if (err) {
			  			return callback(err);
			  		}
			  		callback();
			  	});
			  }
			],
			function(err) {
				if (err) {
					connection.rollback(function() {
						logger.error(err);
						connection.release();
						err.message = '회원 탈퇴를 처리하는 과정에서 오류가 발생하였습니다.';
						return next(err);
					});
				}
				connection.release();
				next();
			}); // end of async.waterfall
		}); // end of pool
	}); // end of nextTick
}

  /* 중복 검사 */
function duplicateCheck(req, res, next) {
	  /* avoid network I/O bottleneck by using nextTick */
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
			if (err) {
				logger.error(err);
				connection.release();
				err.message = '중복 검사 과정에서 오류가 발생하였습니다.';
				return next(err);
			}
			var email = req.body.email;
			var selectQry = 'SELECT email ' +
			                'FROM users ' +
			                'WHERE email = ?';
			connection.query(selectQry, [email], function(err, rows, fields) {
				if (err) {
					logger.error(err);
					connection.release();
					err.message = '중복 검사 과정에서 오류가 발생하였습니다.';
					return next(err);
				}
				if (rows.length) {
					connection.release();
					res.json({
						"success": 0,
						"result": {
							"message": "이미 사용중인 계정입니다."
						}
					});
				}
				else {
					connection.release();
					res.json({
						"success": 1,
						"result": {
							"message": "사용 가능한 계정입니다."
						}
					});
				}
			});
		}); // end of pool
	}); // end of nextTick
}

  /* 로그인 인증 */
function authenticateLocalLogin(req, res, next) {
  passport.authenticate('local-login', function(err, user, info) {
    if (err) {
      logger.error(err);
      err.message = '로그인 인증 오류';
      return next(err);
    }
    if (!user) {
      logger.debug("passport.authenticate('local-login') ====> failed!!! ", info);
      return next({ message : info });
    }
    req.logIn(user, function(err) {
      if (err) {
        logger.error(err);
        err.message = '로그인 인증 오류';
        return next(err);
      }
      logger.debug("passport.authenticate('local-login') ====> success!!!");
      var result = {
      	"success": 1,
      	"result": {
      		"message": "login success",
      		"user": {
      			"userId": user.userId,
      			"email": user.email,
      			"userName": user.userName,
      			"profilePhoto": user.profilePhoto,
      			"examDate": user.examDate,
      			"targetLevel": user.targetLevel,
      			"agreement": user.agreement,
      			"gcmId": user.gcmId,
      			"notification": user.notification,
      			"birthday": user.birthday
      		}
      	}
      };
      res.json(result);
    });
  })(req, res, next);
}

  /* 페이스북 로그인 */
function authenticateFacebookLogin(req, res, next) {
	passport.authenticate('facebook-token', function(err, user, info) {
		if (err) {
			logger.error(err);
			err.message = '페이스북 로그인 인증 오류';
			return next(err);
		}
		if (!user) {
      logger.debug("passport.authenticate('facebook-token') ====> failed!!! ", info);
      return next({ message : info });
    }
		req.logIn(user, function(err) {
      if (err) {
        logger.error(err);
        err.message = '페이스북 로그인 인증 오류';
        return next(err);
      }
      logger.debug("passport.authenticate('facebook-token') ====> success!!!");
      var result = {
      	"success": 1,
      	"result": {
      		"message": "facebook login success",
      		"user": {
      			"userId": user.userId,
      			"email": user.email,
      			"userName": user.userName,
      			"profilePhoto": user.profilePhoto,
      			"examDate": user.examDate,
      			"targetLevel": user.targetLevel,
      			"agreement": user.agreement,
      			"gcmId": user.gcmId,
      			"notification": user.notification,
      			"birthday": user.birthday
      		}
      	}
      };
      res.json(result);
    });
	})(req, res, next);
}

  /* 이용 약관 동의 */
function updateAgreement(req, res, next) {
	  /* avoid network I/O bottleneck by using nextTick */
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
			if (err) {
				logger.error(err);
				connection.release();
				err.message = '이용 약관 동의 오류';
				return next(err);
			}
			var userId = req.user.userId;
			async.waterfall([
			  function beginTransaction(callback) {
			  	connection.beginTransaction(function(err) {
			  		if (err) {
			  			return callback(err);
			  		}
			  		callback();
			  	});
			  },
			  function agreement(callback) {
			  	var updateAgmtQry = 'UPDATE users ' +
			  	                    'SET agreement = ? ' +
			  	                    'WHERE user_id = ?';
			  	connection.query(updateAgmtQry, [1, userId], function(err, result) {
			  		if (err) {
			  			err.message = '이용 약관 동의 오류';
			  			return callback(err);
			  		}
			  		callback();
			  	});
			  },
			  function(callback) {
			  	var updateBirthday = 'UPDATE users ' +
			  	                     'SET birthday = ? ' +
			  	                     'WHERE user_id = ?';
			  	connection.query(updateBirthday, [req.body.birthday, userId], function(err, result) {
			  		if (err) {
			  			err.message = '생년월일 입력 오류';
			  			return callback(err);
			  		}
			  		callback();
			  	});
			  },
			  function commit(callback) {
			  	connection.commit(function(err) {
			  		if (err) {
			  			return callback(err);
			  		}
			  		callback();
			  	});
			  } // end of commit
			],
			function rollback(err) {
				if (err) {
					connection.rollback(function() {
						logger.error(err);
						connection.release();
						return next(err);
					});
				}
				connection.release();
				res.json({
					"success": 1,
					"result": {
						"message": "이용 약관 동의 완료"
					}
				});
			}); // end of async.waterfall
		}); // end of pool
	}); // end of nextTick
}

  /* 로그아웃 */
function logout(req, res, next) {
	if (req.user.facebookId) {
		request({
			url: "https://graph.facebook.com/v2.1/me/permissions?access_token=" + req.user.facebookToken,
			method: 'DELETE'
		},
		function(err, response, body) {
			if (err) {
				logger.error(err);
				err.message = '로그아웃 과정에서 오류가 발생하였습니다.';
				return next(err);
			}
			logger.debug('response.statusCode: ' + response.statusCode);
			logger.debug('body: ', body);
			req.logout();
			res.json({
				"success": 1,
				"result": {
					"message": "로그 아웃 완료",
					"user": req.user
				}
			});
		});
	}
	else { /* local-login */
		var email = req.user.email;
		req.logout();
		res.json({
			"success": 1,
			"result": {
				"message": email + ": 로그 아웃 완료",
				"user": req.user
			}
		});
	}
}

  /* 프로필 조회 */
function getProfile(req, res, next) {
	logger.debug("req.session: ", req.session);
  logger.debug("req.session.passpost.user: ", req.session.passport.user);
  logger.debug("req.user: ", req.user);
	  /* avoid network I/O bottleneck by using nextTick */
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
			if (err) {
				logger.error(err);
				connection.release();
				err.message = '프로필 조회하는 과정에서 오류가 발생하였습니다.';
				return next(err);
			}
			var selectQry = 'SELECT email, user_name, profile_photo, date_format(exam_date, "%Y-%m-%d") exam_date, target_level, birthday, count(m.file_id) posted_file_count, (' +
			                '      SELECT count(file_id) ' +
			                '      FROM mybox_files ' +
			                '      WHERE user_id = ?) mybox_file_count ' +
			                'FROM posts p ' +
			                'JOIN users u ' +
			                'ON p.user_id = u.user_id ' +
			                'JOIN mybox_files m ' +
			                'ON p.recording_file_id = m.file_id ' +
			                'WHERE u.user_id = ?';
			connection.query(selectQry, [req.user.userId, req.user.userId], function(err, rows, fields) {
				if (err) {
					logger.error(err);
					connection.release();
					err.message = '프로필 조회하는 과정에서 오류가 발생하였습니다.';
					return next(err);
				}
				res.json({
					"success": 1,
			  	"result": {
			  		"message": "프로필 조회 성공",
			  		"user": {
			  			"email": rows[0].email,
			  			"userName": rows[0].user_name,
			  			"profilePhoto": rows[0].profile_photo,
			  			"examDate": rows[0].exam_date,
			  			"targetLevel": rows[0].target_level,
			  			"birthday": rows[0].birthday,
			  			"myboxFileCount": rows[0].mybox_file_count,
			  			"postedFileCount": rows[0].posted_file_count
			  		}
			  	}
				});
				connection.release();
			}); // end of connection.query
		}); // end of connectionPool
	}); // end of nextTick
}

  /* 프로필 수정 */
function updateProfile(req, res, next) {
	  /* avoid network I/O bottleneck by using nextTick */
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
			if (err) {
				logger.error(err);
				connection.release();
				err.message = '프로필 수정 오류';
				return next(err);
			}
			var userId = req.user.userId;
			  /* 사용자 텍스트 정보 변경 */
			if (req.headers['content-type'] === 'application/x-www-form-urlencoded') {
				  /* 사용자 이름 변경 */
				if (req.body.userName) {
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
					    var updateName = 'UPDATE users ' +
					                	   'SET user_name = ? ' +
					                	   'WHERE user_id = ?';
					    connection.query(updateName, [req.body.userName, userId], function(err, result) {
					      if (err) {
					        return callback(err);
					      }
					      callback();
					    });
					  },
					  function(callback) {
					    var selectName = 'SELECT email, user_name, profile_photo, date_format(exam_date, "%Y-%m-%d") exam_date, target_level ' +
					                	   'FROM users ' +
					                	   'WHERE user_id = ?';
					    connection.query(selectName, [userId], function(err, rows, fields) {
					    	if (err) {
					    		return callback(err);
					    	}
					    	var resultName = {
					    	  "email": rows[0].email,
					    		"userName": rows[0].user_name,
					    		"profilePhoto": rows[0].profile_photo,
					    		"examDate": rows[0].exam_date,
					    		"targetLevel": rows[0].target_level
					    	};
					    	callback(null, resultName);
					    });
					  },
					  function commit(resultName, callback) {
					  	connection.commit(function(err) {
					  		if (err) {
					  			return callback(err);
					  		}
					  		connection.release();
					  		callback(null, resultName);
					  	});
					  } // end of commit
					],
					function(err, resultName) {
						if (err) {
							connection.rollback(function() {
								logger.error(err);
								connection.release();
								err.message = '이름을 수정하는 과정에서 오류가 발생하였습니다.';
								return next(err);
							});
						}
						var result = {
							"success": 1,
							"result": {
								"message": "사용자 이름 변경 완료",
								"user": resultName
							}	
						};
						return res.json(result);
					}); // end of async.waterfall
				} // end of update userName
				  /* 사용자 시험일 변경 */
				if (req.body.examDate) {
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
					  	var updateDate = 'UPDATE users ' +
					  	                 'SET exam_date = ? ' +
					  	                 'WHERE user_id = ?';
					  	connection.query(updateDate, [req.body.examDate, userId], function(err, result) {
					  		if (err) {
					  			return callback(err);
					  		}
					  		callback();
					  	});
					  },
					  function(callback) {
					  	var selectDate = 'SELECT email, user_name, profile_photo, date_format(exam_date, "%Y-%m-%d") exam_date, target_level ' +
					  	                 'FROM users ' +
					  	                 'WHERE user_id = ?';
					  	connection.query(selectDate, [userId], function(err, rows, fields) {
					  		if (err) {
					  			return callback(err);
					  		}
					  		var resultDate = {
					  			"email": rows[0].email,
						    	"userName": rows[0].user_name,
						    	"profilePhoto": rows[0].profile_photo,
						    	"examDate": rows[0].exam_date,
						    	"targetLevel": rows[0].target_level
					  		};
					  		callback(null, resultDate);
					  	});
					  },
					  function commit(resultDate, callback) {
					  	connection.commit(function(err) {
					  		if (err) {
					  			return callback(err);
					  		}
					  		connection.release();
					  		callback(null, resultDate);
					  	});
					  } // end of commit
					],
					function(err, resultDate) {
						if (err) {
							connection.rollback(function() {
								logger.error(err);
								connection.release();
								err.message = '시험날짜를 수정하는 과정에서 오류가 발생하였습니다.';
								return next(err);
							});
						}
						var result = {
							"success": 1,
						  "result": {
						  	"message": "시험일 변경 완료",
						  	"user": resultDate
						  }	
						};
						return res.json(result);
					}); // end of async.waterfall
				} // end of update examDate
				  /* 사용자 목표 레벨 변경 */
				if (req.body.targetLevel) {
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
					  	var updateLevel = 'UPDATE users ' +
					  	                  'SET target_level = ?	' +
					  	                  'WHERE user_id = ?';
					  	connection.query(updateLevel, [req.body.targetLevel, userId], function(err, result) {
					  		if (err) {
					  			return callback(err);
					  		}
					  		callback();
					  	});
					  },
					  function(callback) {
					  	var selectLevel = 'SELECT email, user_name, profile_photo, date_format(exam_date, "%Y-%m-%d") exam_date, target_level ' +
					  	                  'FROM users ' +
					  	                  'WHERE user_id = ?';
					  	connection.query(selectLevel, [userId], function(err, rows, fields) {
					  		if (err) {
					  			return callback(err);
					  		}
					  		var resultLevel = {
					  			"email": rows[0].email,
							    "userName": rows[0].user_name,
							    "profilePhoto": rows[0].profile_photo,
							    "examDate": rows[0].exam_date,
							    "targetLevel": rows[0].target_level
					  		};
					  		callback(null, resultLevel);
					  	});
					  },
					  function commit(resultLevel, callback) {
					  	connection.commit(function(err) {
					  		if (err) {
					  			return callback(err);
					  		}
					  		connection.release();
					  		callback(null, resultLevel);
					  	});
					  } // end of commit
					],
					function(err, resultLevel) {
						if (err) {
							connection.rollback(function() {
								logger.error(err);
								connection.release();
								err.message = '목표 레벨을 수정하는 과정에서 오류가 발생하였습니다.';
								return next(err);
							});
						}
						var result = {
							"success": 1,
							"result": {
								"message": "사용자 목표 레벨 변경 완료",
								"user": resultLevel
							}
						};
						return res.json(result);
					}); // end of async.waterfall
				} // end of update targetLevel
			}
			else { /* 프로필 사진 변경 */
				var form = new formidable.IncomingForm();
				form.uploadDir = path.join(__dirname, '/../uploads/');
				form.keepExtensions = true;
				form.multiples = false;
				form.parse(req, function(err, fields, files) {
					if (err) {
						logger.error(err);
						connection.release();
						err.message = '프로필 사진을 수정하는 과정에서 오류가 발생하였습니다.';
						return next(err);
					}
					var client = s3.createClient({
		  			s3Options: {
		  				accessKeyId: s3Config.key,
		  				secretAccessKey: s3Config.secret,
		  				region: s3Config.region
		  			}
		  		});
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
					  	var selectCurrentPhoto = 'SELECT profile_photo ' +
					  	                         'FROM users ' +
					  	                         'WHERE user_id = ?';
					  	connection.query(selectCurrentPhoto, [userId], function(err, rows, fields) {
					  		if (err) {
					  			return callback(err);
					  		}
					  		var currentPhoto = path.basename(rows[0].profile_photo);
					  		  /* 현재 이미지가 default 사진이 아닌 경우 삭제 */
					  		if (currentPhoto !== 'default.png') {
					  			var obj = [];
						  		obj.push({ Key: s3Config.imageDir + currentPhoto });
						  		var s3Params = {
						  			Bucket: s3Config.bucket,
						  			Delete: {
						  				Objects: obj
						  			}
						  		};
						  		client.deleteObjects(s3Params)
						  		  .on('error', function(err) {
						  		  	if (err) {
						  		  		return callback(err);
						  		  	}
						  		  })
						  		  .on('end', function() {
						  		  	callback();
						  		  });
					  		}
					  		else { // 현재 이미지가 default 사진인 경우
					  			callback();
					  		}
					  	}); // end of connection.query
					  },
					  function(callback) {
					  	var photoPath = files.profilePhoto.path;
							var photoName = path.basename(photoPath);
					  	var params = {
					  		localFile: photoPath,
					  		s3Params: {
					  			Bucket: s3Config.bucket,
					  			Key: s3Config.imageDir + photoName,
					  			ACL: s3Config.ACL
					  		}
					  	};
					  	var s3Url = s3.getPublicUrl(params.s3Params.Bucket, params.s3Params.Key, s3Config.region);
					  	var uploader = client.uploadFile(params); // S3 File Upload
					  	uploader.on('error', function(err) {
					  		if (err) {
					  			return callback(err);
					  		}
					  	});
					  	uploader.on('end', function() {
					  		callback(null, s3Url);
					  	});
					  },
					  function(s3Url, callback) {
					  	var updatePhoto = 'UPDATE users ' +
					  	                  'SET profile_photo = ? ' +
					  	                  'WHERE user_id = ?';
					  	connection.query(updatePhoto, [s3Url, userId], function(err, result) {
					  		if (err) {
					  			return callback(err);
					  		}
					  		callback();
					  	});
					  },
					  function(callback) {
					  	var selectPhoto = 'SELECT email, user_name, profile_photo ' +
					  	                  'FROM users ' +
					  	                  'WHERE user_id = ?';
					  	connection.query(selectPhoto, [userId], function(err, rows, fields) {
					  		if (err) {
					  			return callback(err);
					  		}
					  		var result = {
					  			"email": rows[0].email,
					  			"userName": rows[0].user_name,
					  			"profilePhoto": rows[0].profile_photo
					  		};
					  		callback(null, result);
					  	});
					  },
					  function commit(result, callback) {
					  	connection.commit(function(err) {
					  		if (err) {
					  			return callback(err);
					  		}
					  		connection.release();
					  		callback(null, result);
					  	});
					  } // end of commit
					],
					function(err, result) {
						if (err) {
							connection.rollback(function() {
								logger.error(err);
								connection.release();
								err.message = '프로필 사진을 수정하는 과정에서 오류가 발생하였습니다.';
								return next(err);
							});	
						}
						res.json({
							"success": 1,
							"result": {
								"message": "프로필 사진 변경 완료",
								"user": result
							}
						});
					}); // end of async.waterfall
				}); // end of form.parse
			} // end of else
		}); // end of pool
	}); // end of nextTick
}

  /* 비밀번호 변경 */
function updatePassword(req, res, next) {
	var currentPassword = req.body.currentPassword;
	var newPassword = req.body.newPassword;
	var newPasswordConfirm = req.body.newPasswordConfirm;	
	var selectQry = 'SELECT password ' +
	                'FROM users ' +
	                'WHERE user_id = ?';
	  /* avoid network I/O bottleneck by using nextTick */
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
			if (err) {
				logger.error(err);
				connection.release();
				err.message = '비밀번호를 수정하는 과정에서 오류가 발생하였습니다.';
				return next(err);
			}
			connection.query(selectQry, [req.user.userId], function(err, rows, fields) {
				if (err) {
					logger.error(err);
					connection.release();
					err.message = '비밀번호를 수정하는 과정에서 오류가 발생하였습니다.';
					return next(err);
				}
				bcrypt.compare(currentPassword, rows[0].password, function(err, result) {
			    if (!result){
			    	err.message = '잘못된 비밀번호입니다.';
			    	connection.release();
			      return next(err);
			    }
			    if (newPassword !== newPasswordConfirm) {
			    	err.message = '새로운 비밀번호가 일치하지 않습니다.';
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
			      function generateSalt(callback) {
			        var rounds = 10;
			        bcrypt.genSalt(rounds, function(err, salt) {
			        	if (err) {
			        		return callback(err);
			        	}
			          logger.debug('bcrypt.genSalt() ====> ' + salt + '(' + salt.toString().length +')');
			          callback(null, salt);
			        });
			      },
			      function hashPassword(salt, callback) {
			        bcrypt.hash(newPassword, salt, null, function(err, hashPass) {
			        	if (err) {
			        		return callback(err);
			        	}
			          logger.debug('bcrypt.hash() ====> ' + hashPass + '(' + hashPass.length + ')');
			          var updateQry = 'UPDATE users ' +
			                          'SET password = ? ' +
			                          'WHERE user_id = ?';
			          connection.query(updateQry, [hashPass, req.user.userId], function(err, result) {
			          	if (err) {
										return callback(err);
									}
			          	callback();
			          });
			        }); // end of bcrypt.hash
			      }, // end of hashPassword
			      function commit(callback) {
			      	connection.commit(function(err) {
			      		if (err) {
			      			return callback(err);
			      		}
			      		connection.release();
			      		callback();
			      	});
			      }
			    ],
			    function(err) {
			    	if (err) {
			    		connection.rollback(function() {
			    			logger.error(err);
		        		connection.release();
		        		err.message = '비밀번호를 수정하는 과정에서 오류가 발생하였습니다.';
		        		return next(err);
			    		});
	        	}
			      res.json({
			      	"success": 1,
			      	"result": {
			      		"message": "비밀번호 변경 완료"
			      	}
			      });
			    }); // end of async.waterfall
			  }); // end of bcrypt.compare
		  }); // end of connection.query
		}); // end of pool
	}); // end of nextTick
}

  /* 본인 인증 */
function identification(req, res, next) {
	var email = req.body.email;
	var userName = req.body.userName;
	var birthday = req.body.birthday;
	  /* avoid network I/O bottleneck by using nextTick */
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
			if (err) {
				logger.error(err);
				connection.release();
				err.message = '본인 인증 과정에서 오류가 발생하였습니다.';
				return next(err);
			}
			var selectQry = 'SELECT user_id ' +
			                'FROM users ' +
			                'WHERE email = ? and user_name = ? and birthday = ?';
			connection.query(selectQry, [email, userName, birthday], function(err, rows, fields) {
				if (err) {
					logger.error(err);
					connection.release();
					err.message = '본인 인증 과정에서 오류가 발생하였습니다.';
					return next(err);
				}
				if (!rows.length) {
					connection.release();
					var error = new Error('일치하는 정보가 없습니다.');
					return next(error);
				}
				connection.release();
				res.json({
					"success": 1,
					"result": {
						"message": "본인 인증 성공"
					}
				});
			});
		}); // end of pool
	}); // end of nextTick
}

  /* 인증 후 비밀번호 재설정 */
function resetPassword(req, res, next) {
	var newPassword = req.body.newPassword;
	  /* avoid network I/O bottleneck by using nextTick */
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
			if (err) {
				logger.error(err);
				connection.release();
				err.message = '비밀번호 재설정 과정에서 오류가 발생하였습니다.';
				return next(err);
			}
			async.waterfall([
			  function beginTransaction(callback) {
			  	connection.beginTransaction(function(err) {
			  		if (err) {
			  			err.message = '비밀번호 재설정 과정에서 오류가 발생하였습니다.';
			  			return callback(err);
			  		}
			  		callback();
			  	});
			  },
			  function generateSalt(callback) {
			    var rounds = 10;
			    bcrypt.genSalt(rounds, function(err, salt) {
			    	if (err) {
			    		err.message = '비밀번호 재설정 과정에서 오류가 발생하였습니다.';
			    		return callback(err);
			    	}
			      logger.debug('bcrypt.genSalt() ====> ' + salt + '(' + salt.toString().length +')');
			      callback(null, salt);
			    });
			  },
			  function hashPassword(salt, callback) {
			  	bcrypt.hash(newPassword, salt, null, function(err, hashPass) {
			  		if (err) {
			  			err.message = '비밀번호 재설정 과정에서 오류가 발생하였습니다.';
			  			return callback(err);
			  		}
			  		logger.debug('bcrypt.hash() ====> ' + hashPass + '(' + hashPass.length + ')');
			  		var updateQry = 'UPDATE users ' +
			  		                'SET password = ? ' +
			  		                'WHERE email = ?';
			  		connection.query(updateQry, [hashPass, req.user.email], function(err, result) {
			  			if (err) {
			  				err.message = '비밀번호 재설정 과정에서 오류가 발생하였습니다.';
			  				return callback(err);
			  			}
			  			callback();
			  		});
			  	}); // end of bcrypt.hash
			  }, // end of hashPassword
			  function commit(callback) {
			  	connection.commit(function(err) {
			  		if (err) {
			  			err.message = '비밀번호 재설정 과정에서 오류가 발생하였습니다.';
			  			return callback(err);
			  		}
			  		connection.release();
			  		callback();
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
						"message": "비밀번호 재설정 완료"
					}
				});
			}); // end of async.waterfall
		}); // end of pool
	}); // end of nextTick
}

  /* 푸시 알림 설정 */
function setNotification(req, res, next) {
	  /* avoid network I/O bottleneck by using nextTick */
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
			if (err) {
				logger.error(err);
				connection.release();
				err.message = '푸시 알림 설정 오류';
				return next(err);
			}
			var OnOff = (req.params.OnOff === 1) ? 'On' : 'Off';
			var updateQry = 'UPDATE users ' +
			                'SET notification = ? ' +
			                'WHERE user_id = ?';
			connection.query(updateQry, [req.params.OnOff, req.user.userId], function(err, result) {
				if (err) {
					logger.error(err);
					connection.release();
					err.message = '푸시 알림 설정 오류';
					return next(err);
				}
				connection.release();
				res.json({
					"success": 1,
					"result": {
						"message": "알림 설정 " + OnOff
					}
				});
			});
		}); // end of pool
	}); // end of nextTick
}

router.route('/')
  .post(authenticateLocalSignup) // 회원 가입
  .delete(deleteUser, logout); // 회원 탈퇴
router.post('/duplicateCheck', duplicateCheck); // 중복 검사
router.post('/login', authenticateLocalLogin); // 로그인
router.post('/facebookLogin', authenticateFacebookLogin); // 페이스북 로그인
router.put('/agreement', updateAgreement); // 이용 약관 동의
router.get('/logout', logout); // 로그아웃
router.route('/profile')
  .get(isLoggedIn, getProfile) // 프로필 조회
  .put(updateProfile); // 프로필 수정
router.put('/password', updatePassword); // 비밀번호 변경
router.post('/identification', identification); // 본인 인증
router.put('/resetPassword', resetPassword); // 인증 후 비밀번호 재설정
router.put('/notification/:OnOff', setNotification); // 푸시 알림 설정

module.exports = router;