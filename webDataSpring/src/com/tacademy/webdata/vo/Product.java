package com.tacademy.webdata.vo;

import java.io.Serializable;

public class Product implements Serializable {

	private int num;
	private String title;
	private String count;
	private int price;
	private String image;
	private char category;
	
	private String key;
	private String type;
	
	public String getType() {
		return type;
	}

	public void setType(String type) {
		this.type = type;
	}

	public String getKey() {
		return key;
	}

	public void setKey(String key) {
		this.key = key;
	}

	public int getNum() {
		return num;
	}

	public void setNum(int num) {
		this.num = num;
	}

	public String getTitle() {
		return title;
	}

	public void setTitle(String title) {
		this.title = title;
	}

	public String getCount() {
		return count;
	}

	public void setCount(String count) {
		this.count = count;
	}

	public int getPrice() {
		return price;
	}

	public void setPrice(int price) {
		this.price = price;
	}

	public String getImage() {
		return image;
	}

	public void setImage(String image) {
		this.image = image;
	}

	public char getCategory() {
		return category;
	}

	public void setCategory(char category) {
		this.category = category;
	}

	@Override
	public String toString() {
		return "Product [num=" + num + ", title=" + title + ", count=" + count + ", price=" + price + ", image=" + image
				+ ", category=" + category + "]";
	}


}
