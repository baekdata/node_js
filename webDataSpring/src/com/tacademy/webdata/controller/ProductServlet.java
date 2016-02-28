package com.tacademy.webdata.controller;

import java.io.IOException;
import java.util.List;

import javax.servlet.RequestDispatcher;
import javax.servlet.ServletException;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import com.google.gson.Gson;
import com.tacademy.webdata.conf.ServerInfo;
import com.tacademy.webdata.dao.ProductDAO;
import com.tacademy.webdata.vo.Product;
import com.tacademy.webdata.vo.ProductResultJson;

/**
 * Servlet implementation class ProductServlet
 */
@WebServlet("/ProductServlet")
public class ProductServlet extends HttpServlet implements ServerInfo {
	private static final long serialVersionUID = 1L;

	/**
	 * @see HttpServlet#doGet(HttpServletRequest request, HttpServletResponse response)
	 */
	protected void doGet(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {
		//key, category
		String keyStr = request.getParameter("key");
		byte[] bytes = keyStr.getBytes("iso-8859-1");
		
		
		String key = new String(bytes,"utf-8");
		String category = request.getParameter("category");
		String type = request.getParameter("type");
		
		Product product = new Product();
		product.setKey(key);
		product.setCategory(category.toCharArray()[0]);
		product.setType(type);
		
		ProductDAO dao = new ProductDAO();
		List<Product> items = dao.searchProduct(product);
		
		switch(Integer.valueOf(type)){
		case 0://json
			ProductResultJson productJson = new ProductResultJson();
			productJson.setStatus("success");
			productJson.setCount(items.size()+"");
			productJson.setpList(items);
			
			Gson gson = new Gson();
			request.setAttribute("result", gson.toJson(productJson));
			doForward(request, response, RETURN_JSON);
			break;
		case 1://xml
			request.setAttribute("product", product);
			request.setAttribute("list",items);
			doForward(request, response, RETURN_XML);
			
			break;
		}
		
		
	}

	public void doForward(HttpServletRequest request, HttpServletResponse response,String path)
			 throws ServletException, IOException{
		RequestDispatcher dispatcher = request.getRequestDispatcher(path);
		dispatcher.forward(request, response);
	}
}
