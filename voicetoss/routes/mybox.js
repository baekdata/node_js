var express = require('express');
var router = express.Router();
var async = require('async');
var mysql = require('mysql');
var fs = require('fs');
var path = require('path');
var fstools = require('fs-tools');
var formidable = require('formidable');
var logger = require('../config/logger');
var dbConfig = require('../config/database');
var pool = mysql.createPool(dbConfig);
var server = 'http://ec2-54-64-102-246.ap-northeast-1.compute.amazonaws.com';
var s3 = require('s3');
var s3Config = require('../config/s3');

  /* mybox 파일 목록 조회 */
function getMybox(req, res, next) {
	  /* avoid network I/O bottleneck by using nextTick */
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
		  if (err) {
		  	logger.error(err);
		  	connection.release();
			  return next(err);
		  }
		  var selectQry = 'SELECT file_id, file_name, part_id, replay_time, date_format(record_date, "%Y-%m-%d") record_date, file_path ' +
		                  'FROM mybox_files ' +
		                  'WHERE user_id = ?';
		  connection.query(selectQry, [req.user.userId], function(err, rows, fields) {
		 	  if (err) {
		 	  	logger.error(err);
				  connection.release();
				  return next(err);
			  }
		 	  if (rows.length === 0) {
		 	  	connection.release();
		 	  	var result = {
		 	  		"success": 1,
			 			"result": {
			 				"message": "mybox 파일 목록 조회",
			 				"myBoxFileList": []
			 			}
		 	  	};
		 	  	return res.json(result);
		 	  }
		 	  async.waterfall([
		 	    function beginTransaction(callback) {
		 	    	connection.beginTransaction(function(err) {
		 	    		if (err) {
		 	    			return callback(err);
		 	    		}
		 	    	});
		 	    	callback();
		 	    },
		 	    function getFileList(callback) {
		 	    	var result = [];
		 	    	async.each(rows,
						  function iterator(row, done) {
						    var file = {};
						    file.fileId = row.file_id;
						 	  file.fileName = row.file_name;
						 	  file.partId = row.part_id;
						 	  file.replayTime = row.replay_time;
						 	  file.recordDate = row.record_date;
						 	  file.filePath = row.file_path;
						 	  file.email = req.user.email;
						 	  result.push(file);
						 	  done();
						 	},
						 	function(err) {
						 		if (err) {
									return callback(err);
								}
						 	}
						); // end of async.each
		 	    	callback(null, result);
		 	    }, // end of getFileList
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
		 	  function rollback(err, result) {
		 	  	if (err) {
		 	  		connection.rollback(function() {
		 	  			logger.error(err);
		 	  			connection.release();
		 	  			err.message = 'mybox 파일 목록 조회 오류';
		 	  			return next(err);
		 	  		});
		 	  	}
		 	  	res.json({
		 	  		"success": 1,
		 	  		"result": {
		 	  			"message": "mybox 파일 목록 조회",
		 	  			"myBoxFileList": result
		 	  		}
		 	  	});
		 	  }); // end of async.waterfall
		  }); // end of connection.query
	  }); // end of pool
	}); // end of nextTick
}

  /* 파일 업로드 */
function uploadRecordFile(req, res, next) {
	var form = new formidable.IncomingForm();
  form.uploadDir = path.join(__dirname, '/../uploads/');
  form.keepExtensions = true;
  form.multiples = false;
  
  form.parse(req, function(err, fields, files) {
  	if (err) {
  		logger.error(err);
  		err.message = '파일 업로드 오류';
  		return next(err);
  	}
  	/* avoid network I/O bottleneck by using nextTick */
  	process.nextTick(function() {
  		pool.getConnection(function(err, connection) {
  			if (err) {
  				logger.error(err);
  				connection.release();
  				err.message = '파일 업로드 오류';
  				return next(err);
  			}
  			var fileName = fields.fileName;
		  	var partId = fields.partId;
		  	var replayTime = fields.replayTime;
		  	var userId = req.user.userId;
  			var realFilePath = files.filePath.path;
		  	
  			async.waterfall([
  			  function beginTransaction(callback) {
  			    connection.beginTransaction(function(err) {
  			    	if (err) {
  			    		return callback(err);
  			    	}
  			    	callback();
  			    });
  			  },
  			  function(callback){
  			  	var client = s3.createClient({
  			  		s3Options: {
  			  			accessKeyId: s3Config.key,
  			  			secretAccessKey: s3Config.secret,
  			  			region: s3Config.region
  			  		}
  			  	});
  			  	var params = {
  			  		localFile: realFilePath,
  			  		s3Params: {
  			  			Bucket: s3Config.bucket,
  			  			Key: s3Config.myboxDir + path.basename(realFilePath),
  			  			ACL: s3Config.ACL
  			  		}
  			  	};
  			  	var s3Url = s3.getPublicUrl(params.s3Params.Bucket, params.s3Params.Key, s3Config.region);
  			  	  /* S3 파일 업로드 */
  			  	var uploader = client.uploadFile(params);

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
  			  	var insertQry = 'INSERT INTO recording_files ' +
  			  	                '(file_name, part_id, replay_time, user_id, file_path) ' +
  			  	                'VALUES (?, ?, ?, ?, ?)';	
  			  	connection.query(insertQry, [fileName, partId, replayTime, userId, s3Url], function(err, result) {
  			  		if (err) {
  			  			return callback(err);
  			  		}
  			  		var recordingFileId = result.insertId;
  			  		callback(null, recordingFileId, s3Url);
  			  	});
  			  },
  			  function(recordingFileId, s3Url, callback) {
  			  	var insertQry = 'INSERT INTO mybox_files ' +
  			  	                '(file_name, part_id, replay_time, user_id, recording_file_id, file_path) ' +
  			  	                'VALUES (?, ?, ?, ?, ?, ?)';
  			  	connection.query(insertQry, [fileName, partId, replayTime, userId, recordingFileId, s3Url], function(err, result) {
  			  		if (err) {
  			  			return callback(err);
  			  		}
  			  		var myBoxFileId = result.insertId;
  			  		callback(null, myBoxFileId);
  			  	});
  			  },
  			  function(myBoxFileId, callback) {
  			  	var selectQry = 'SELECT file_name, part_id, replay_time, record_date, file_path ' +
  			  	                'FROM mybox_files ' +
  			  	                'WHERE file_id = ?';
  			  	connection.query(selectQry, [myBoxFileId], function(err, rows, fields) {
  			  		if (err) {
  			  			return callback(err);
  			  		}
  			  		var result = {
  			  			"success": 1,
  			  			"result": {
  			  				"message": "파일 업로드 성공",
  			  				"myBoxFile": {
  			  					"fileId": myBoxFileId,
  			  					"fileName": rows[0].file_name,
  			  					"partId": rows[0].part_id,
  			  					"replayTime": rows[0].replay_time,
  			  					"recordDate": rows[0].record_date,
  			  					"filePath": rows[0].file_path,
  			  					"userId" : userId
  			  				}
  			  			}
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
  			function rollback(err, result) {
  				if (err) {
  					connection.rollback(function() {
  						logger.error(err);
  						connection.release();
  						return next(err);
  					});
  				}
  				res.json(result);
  			}); // end of async.waterfall  		  		
  		}); // end of pool
  	}); // end of nextTick
  }); // end of form.parse
}

  /* mybox 파일 전체 삭제 */
function deleteAllFiles(req, res, next) {
	  /* avoid network I/O bottleneck by using nextTick */
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
			if (err) {
				logger.error(err);
				connection.release();
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
			  function(callback) {
			  	var deleteQry = 'DELETE FROM mybox_files ' +
                          'WHERE user_id = ?';
			  	connection.query(deleteQry, [userId], function(err, result) {
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
			  		connection.release();
			  		callback();
			  	});
			  } // end of commit
			],
			function rollback(err) {
				if (err) {
					logger.error(err);
					connection.release();
					err.message = 'mybox 파일 전체 삭제 오류';
					return next(err);
				}
				res.json({
					"sucess": 1,
					"result": {
						"message": "mybox 파일 전체 삭제 완료"
					}
				});
			}); // end of async.waterfall			
		}); // end of pool
	}); // end of nextTick
}

  /* mybox 파일 선택 삭제 */
function deleteSomeFiles(req, res, next) {
	  /* avoid network I/O bottleneck by using nextTick */
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
			if (err) {
				logger.error(err);
				connection.release();
				return next(err);
			}
			var userId = req.user.userId;
			var fileIds = req.query.fileIds;
			var deleteQry = 'DELETE FROM mybox_files ' +
                      'WHERE file_id = ?';
			if (fileIds instanceof Array) {
				async.each(fileIds,
					function iterator(fileId, done) {
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
					  	  connection.query(deleteQry, [fileId], function(err, result) {
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
					    } // end of commit
					  ],
					  function rollback(err) {
						  if (err) {
							  connection.rollback(function() {
								  logger.error(err);
								  connection.release();
								  err.message = 'mybox 파일 삭제 오류';
								  return done(err);
							  });
						  }
						  done();
					  }); // end of async.waterfall
				  }, // end of iterator
				  function(err) {
					  if (err) {
					  	logger.error(err);
					  	connection.release();
						  err.message = 'mybox 파일 삭제 오류';
						  return next(err);
					  }
					  connection.release();
					  res.json({
					  	"success": 1,
							"result": {
							  "message": "mybox 파일 삭제 완료"
							}
					  });
				  }
				); // end of async.each
			} // end of array
			else { /* 1개의 파일 삭제 */	
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
				  	var deleteQry = 'DELETE FROM mybox_files ' +
				  	                'WHERE user_id = ? and file_id = ?';
				  	connection.query(deleteQry, [userId, fileIds], function(err, result) {
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
				  		connection.release();
				  		callback();
				  	});
				  } // end of commit
				],
				function rollback(err) {
					if (err) {
						connection.rollback(function() {
							logger.error(err);
							connection.release();
							err.message = 'mybox 파일 삭제 오류';
							return next(err);
						});
					}
					res.json({
						"success": 1,
						"result": {
							"message": "mybox 파일 삭제 완료"
						}	
					});
				}); // end of async.waterfall
			}
	  }); // end of pool
	}); // end of nextTick
}

  /* 파트별 파일 조회 */
function viewFilesByPart(req, res, next) {
	  /* avoid network I/O bottleneck by using nextTick */
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
			if (err) {
				logger.error(err);
				connection.release();
				return next(err);
			}
			var selectQry = 'SELECT file_id, file_name, part_id, replay_time, date_format(record_date, "%Y-%m-%d") record_date, file_path ' +
			                'FROM mybox_files ' +
			                'WHERE user_id = ? and part_id = ?';
			connection.query(selectQry, [req.user.userId, req.params.partId], function(err, rows, fields) {
				if (err) {
					logger.error(err);
					connection.release();
					return next(err);
				}
				connection.beginTransaction(function(err) {
					if (err) {
						logger.error(err);
						connection.release();
						return next(err);
					}
					var result = [];
					async.each(rows,
						function iterator(row, done) {
						  var file = {};
						  file.fileId = row.file_id;
						  file.fileName = row.file_name;
						  file.partId = row.part_id;
						  file.replayTime = row.replay_time;
						  file.recordDate = row.record_date;
						  file.filePath = row.file_path;
						  result.push(file);
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
							  	"message": "파트별 파일 조회",
							  	"myBoxFileList": result
								}
							});
						}
					); // end of async.each	
				}); // end of transaction
				function rollback(err) {
					connection.rollback(function() {
						logger.error(err);
						connection.release();
						err.message = '파트별 파일 조회 오류';
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

  /* 파일명 수정 */
function updateFileName(req, res, next) {
	  /* avoid network I/O bottleneck by using nextTick */
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
  		if (err) {
  			logger.error(err);
				connection.release();
				return next(err);
			}
  		async.waterfall([
  		  function(callback) {
  		  	var userId = req.user.userId;
  		  	var fileId = req.params.fileId;
  		  	var updateQry = 'UPDATE mybox_files ' +
                          'SET file_name = ? ' +
                          'WHERE user_id = ? and file_id = ?';
  		  	connection.query(updateQry, [req.body.fileName, userId, fileId], function(err, result) {
  		  		if (err) {
  		  			return callback(err);
  		  		}
  		  		callback(null, userId, fileId);
  		  	}); // end of connection.query
  		  },
  		  function getUpdatedFileName(userId, fileId, callback) {
  		  	var selectQry = 'SELECT file_name ' +
  		  	                'FROM mybox_files ' +
  		  	                'WHERE user_id = ? and file_id = ?';
  		  	connection.query(selectQry, [userId, fileId], function(err, rows, fields) {
  		  		if (err) {
  		  			return callback(err);
  		  		}
  		  		var result = {};
  		  		result.fileId = fileId;
  		  		result.fileName = rows.file_name;
  		  		connection.release();
  		  		callback(null, result);
  		  	});
  		  }
  		],
  		function(err, result) {
  			if (err) {
					logger.error(err);
					connection.release();
					return next(err);
				}
	  		res.json({
	  			"success": 1,
	  			"result": {
	  				"message": "파일명 수정",
	  				"myBoxFile": result
	  		  }
	  		});
  		}); // end of async.waterfall
  	}); // end of pool
	}); // end of nextTick
}

  /* mybox 파일 삭제 */
function deleteFile(req, res, next) {
	  /* avoid network I/O bottleneck by using nextTick */
	process.nextTick(function() {
		pool.getConnection(function(err, connection) {
  		if (err) {
  			logger.error(err);
				connection.release();
				return next(err);
			}
  		var userId = req.user.userId;
  		var fileId = req.params.fileId;
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
  		  	var deleteQry = 'DELETE FROM mybox_files ' +
  		  	                'WHERE user_id = ? and file_id = ?';
  		  	connection.query(deleteQry, [userId, fileId], function(err, result) {
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
  		  		connection.release();
  		  		callback();
  		  	});
  		  } // end of commit
  		],
  		function rollback(err) {
  			if (err) {
  				connection.rollback(function() {
  					logger.error(err);
  					connection.release();
  					err.message = 'mybox 파일 삭제 오류';
  					return next(err);
  				});
  			}
  			res.json({
  				"success": 1,
  				"result": {
  					"message": "mybox 파일 삭제 완료"
  				}
  			});
  		}); // end of async.waterfall
  	}); // end of pool
	}); // end of nextTick
}

router.route('/')
  .get(getMybox) // mybox 파일 목록 조회
  .post(uploadRecordFile); // 파일 업로드

router.delete('/deleteAll', deleteAllFiles); // mybox 파일 전체 삭제
router.delete('/deleteSome', deleteSomeFiles); // mybox 파일 선택 삭제

router.get('/part/:partId', viewFilesByPart); // 파트별 파일 조회

router.route('/file/:fileId')
  .put(updateFileName) // 파일명 수정
  .delete(deleteFile); // 파일 삭제

module.exports = router;