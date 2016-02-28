package com.tacademy.webdata.dao;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

import com.tacademy.webdata.vo.Member;

public class MemberDAO {

	private static final String LOGIN="select name from anmember where id=? and pw=?";
	private static final String SIGNUP=	"insert into ANMEMBER values(null, ?, ?, ?, ?, ?, ?, now());";
	private static final String CHECK_ID="select id from anmember where id=?";
	//중복체크
	public void doCheckId(Member member){
		Connection con = null;
		PreparedStatement stmt = null;
		ResultSet rst = null;
		try{
			con = JDBCUtil.getConnection();
			stmt = con.prepareStatement(CHECK_ID);
			stmt.setString(1, member.getId());
			rst = stmt.executeQuery();
			if(rst.next()){
				member.setResult("fail");
			}
			else{
				member.setResult(member.getId());
			}
		}
		catch(SQLException e){
			System.out.println("login error : " + e);
		}
		finally {
			JDBCUtil.close(rst,stmt,con);
		}
	}
	
	//회원가입
	public void doSignUp(Member member){
		Connection con = null;
		PreparedStatement stmt = null;
		
		try{
			con = JDBCUtil.getConnection();
			stmt = con.prepareStatement(SIGNUP);
			stmt.setString(1, member.getName());
			stmt.setString(2, member.getId());
			stmt.setString(3, member.getPw());
			stmt.setString(4, member.getTel());
			stmt.setString(5, member.getAddress());
			stmt.setString(6, member.getComment());
			int cnt = stmt.executeUpdate();
			member.setResult(cnt==1?member.getName():"fail");
		}
		catch(SQLException e){
			System.out.println(e);
		}
		finally {
			JDBCUtil.close(stmt, con);
		}
	}
	
	public void doLogin(Member member){
		Connection con = null;
		PreparedStatement stmt = null;
		ResultSet rst = null;
		try{
			con = JDBCUtil.getConnection();
			stmt = con.prepareStatement(LOGIN);
			stmt.setString(1, member.getId());
			stmt.setString(2, member.getPw());
			rst = stmt.executeQuery();
			if(rst.next()){
				member.setName(rst.getString(1));
				member.setResult(rst.getString(1));
			}
			else{
				member.setResult("fail");
			}
		}
		catch(SQLException e){
			System.out.println("login error : " + e);
		}
		finally {
			JDBCUtil.close(rst,stmt,con);
		}
	}
}
