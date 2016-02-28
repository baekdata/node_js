package com.tacademy.webdata.dao;

import java.io.Serializable;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

import com.tacademy.webdata.vo.Product;

public class ProductDAO implements Serializable {
	private static final long serialVersionUID = -6806016480905663131L;

	private static final String SEARCH_ALL = "select * from product";
	private static final String SEARCH_ALL_WITH_CATEGORY = "select * from product where category=?";
	private static final String SEARCH_KEY = "select * from product where title=?";
	private static final String SEARCH_KEY_WITH_CATEGORY = "select * from product where title=? and category=?";
	
	
	public List<Product> searchProduct(Product product) {
		if("empty".equals(product.getKey())){
			if(product.getCategory()!='0'){
				return searchAllQueryWhereCategory(product);
			}
			else{
				return searchAllQuery(product);
			}
		}
		else{
			if(product.getCategory()!='0'){
				return searchKeyQueryWithCategory(product);
			}
			else{
				return searchKeyQuery(product);
			}
		}
	}
	

	private List<Product> searchAllQuery(Product product){
		List<Product> items = new ArrayList<Product>();
		
		Connection con = null;
		PreparedStatement stmt = null;
		ResultSet rst = null;
		try {
			con = JDBCUtil.getConnection();
			stmt = con.prepareStatement(SEARCH_ALL);
			rst = stmt.executeQuery();
			while(rst.next()){
				Product p = new Product();
				p.setNum(rst.getInt("num"));
				p.setTitle(rst.getString("title"));
				p.setCount(rst.getString("count"));
				p.setPrice(rst.getInt("price"));
				p.setImage(rst.getString("image"));
				p.setCategory(rst.getString("category").toCharArray()[0]);
				
				items.add(p);
				System.out.println(p);
			}
			return items;
		} catch (SQLException e) {
			System.out.println("login error : " + e);
			return null;
		} finally {
			JDBCUtil.close(rst, stmt, con);
		}
	}
	
	private List<Product> searchAllQueryWhereCategory(Product product){
		List<Product> items = new ArrayList<Product>();
		
		Connection con = null;
		PreparedStatement stmt = null;
		ResultSet rst = null;
		try {
			con = JDBCUtil.getConnection();
			stmt = con.prepareStatement(SEARCH_ALL_WITH_CATEGORY);
			stmt.setString(1,product.getCategory() + "");
			rst = stmt.executeQuery();
			while(rst.next()){
				Product p = new Product();
				p.setNum(rst.getInt("num"));
				p.setTitle(rst.getString("title"));
				p.setCount(rst.getString("count"));
				p.setPrice(rst.getInt("price"));
				p.setImage(rst.getString("image"));
				p.setCategory(rst.getString("category").toCharArray()[0]);
				
				items.add(p);
				System.out.println(p);
			}
			return items;
		} catch (SQLException e) {
			System.out.println("login error : " + e);
			return null;
		} finally {
			JDBCUtil.close(rst, stmt, con);
		}
	}

	
	private List<Product> searchKeyQuery(Product product){
		List<Product> items = new ArrayList<Product>();
		
		Connection con = null;
		PreparedStatement stmt = null;
		ResultSet rst = null;
		try {
			con = JDBCUtil.getConnection();
			stmt = con.prepareStatement(SEARCH_KEY);
			stmt.setString(1,product.getKey() + "");
			rst = stmt.executeQuery();
			while(rst.next()){
				Product p = new Product();
				p.setNum(rst.getInt("num"));
				p.setTitle(rst.getString("title"));
				p.setCount(rst.getString("count"));
				p.setPrice(rst.getInt("price"));
				p.setImage(rst.getString("image"));
				p.setCategory(rst.getString("category").toCharArray()[0]);
				
				items.add(p);
				System.out.println(p);
			}
			return items;
		} catch (SQLException e) {
			System.out.println("login error : " + e);
			return null;
		} finally {
			JDBCUtil.close(rst, stmt, con);
		}
	}
	
		private List<Product> searchKeyQueryWithCategory(Product product){
			List<Product> items = new ArrayList<Product>();
			
			Connection con = null;
			PreparedStatement stmt = null;
			ResultSet rst = null;
			try {
				con = JDBCUtil.getConnection();
				stmt = con.prepareStatement(SEARCH_KEY_WITH_CATEGORY);
				stmt.setString(1,product.getKey() + "");
				stmt.setString(2,product.getCategory() + "");
				rst = stmt.executeQuery();
				while(rst.next()){
					Product p = new Product();
					p.setNum(rst.getInt("num"));
					p.setTitle(rst.getString("title"));
					p.setCount(rst.getString("count"));
					p.setPrice(rst.getInt("price"));
					p.setImage(rst.getString("image"));
					p.setCategory(rst.getString("category").toCharArray()[0]);
					
					items.add(p);
					System.out.println(p);
				}
				return items;
			} catch (SQLException e) {
				System.out.println("login error : " + e);
				return null;
			} finally {
				JDBCUtil.close(rst, stmt, con);
			}
		}
	
}
