package com.tacademy.webdata.vo;

import java.util.List;

public class ProductResultJson {
	private String status;
	private String count;
	List<Product> pList;
	
	public String getStatus() {
		return status;
	}
	public void setStatus(String status) {
		this.status = status;
	}
	public String getCount() {
		return count;
	}
	public void setCount(String count) {
		this.count = count;
	}
	public List<Product> getpList() {
		return pList;
	}
	public void setpList(List<Product> pList) {
		this.pList = pList;
	}
	@Override
	public String toString() {
		return "ProductResultJson [status=" + status + ", count=" + count + ", pList=" + pList + "]";
	}
	
	
}
