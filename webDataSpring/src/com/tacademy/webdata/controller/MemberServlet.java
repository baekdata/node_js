package com.tacademy.webdata.controller;

import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

import javax.servlet.RequestDispatcher;
import javax.servlet.ServletException;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import com.tacademy.webdata.conf.ServerInfo;
import com.tacademy.webdata.dao.JDBCUtil;
import com.tacademy.webdata.dao.MemberDAO;
import com.tacademy.webdata.vo.Member;

/**
 * Servlet implementation class MemberServlet
 */
@WebServlet("/MemberServlet")
public class MemberServlet extends HttpServlet implements ServerInfo {
	private static final long serialVersionUID = 1L;

	/**
	 * @see HttpServlet#doGet(HttpServletRequest request, HttpServletResponse
	 *      response)
	 */
	protected void doGet(HttpServletRequest request, HttpServletResponse response)
			throws ServletException, IOException {

	}

	/**
	 * @see HttpServlet#doPost(HttpServletRequest request, HttpServletResponse
	 *      response)
	 */
	protected void doPost(HttpServletRequest request, HttpServletResponse response)
			throws ServletException, IOException {
		request.setCharacterEncoding("utf-8");
		// doGet(request, response);
		String action = request.getParameter("action");

		if ("login".equals(action)) {
			doLogin(request, response);
		} else if ("insert".equals(action)) {
			doSignUp(request, response);
		} else if ("check".equals(action)) {
			doCheckId(request, response);
		}
	}
	
	public void doCheckId(HttpServletRequest request, HttpServletResponse response)
			throws ServletException, IOException{
		Member member = new Member();
		member.setId(request.getParameter("id"));
		
		MemberDAO dao = new MemberDAO();
		dao.doCheckId(member);

		request.setAttribute("member",member);
		request.setAttribute("result", member.getResult());
		doForward(request, response, RESULT_JSP);
	}

	public void doSignUp(HttpServletRequest request, HttpServletResponse response)
			throws ServletException, IOException {
		Member member = new Member();

		member.setId(request.getParameter("id"));
		member.setPw(request.getParameter("pw"));
		member.setName(request.getParameter("name"));
		member.setTel(request.getParameter("tel"));
		member.setAddress(request.getParameter("address"));
		member.setComment(request.getParameter("comment"));

		MemberDAO dao = new MemberDAO();
		dao.doSignUp(member);
		
		request.setAttribute("result", member.getResult());
		doForward(request, response, RESULT_JSP);

	}

	public void doLogin(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {
		Member member = new Member();
		member.setId(request.getParameter("id"));
		member.setPw(request.getParameter("pw"));
		MemberDAO dao = new MemberDAO();
		dao.doLogin(member);
		request.setAttribute("result", member.getResult());
		doForward(request, response, RESULT_JSP);
	}

	public void doForward(HttpServletRequest request, HttpServletResponse response,String path)
			 throws ServletException, IOException{
		RequestDispatcher dispatcher = request.getRequestDispatcher(path);
		dispatcher.forward(request, response);
	}
	
}
