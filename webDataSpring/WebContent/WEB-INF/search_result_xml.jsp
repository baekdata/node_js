<%@ page language="java" contentType="application/xml; charset=UTF-8"
    pageEncoding="UTF-8"%><%@taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %><?xml version="1.0" encoding="utf-8"?>
<pList>
	<c:forEach var="board" items="${list }">
		<item>
			<title>${board.title }</title>
			<count>${board.count }</count>
			<price>${board.price }</price>
			<image>${board.image }</image>
			<category>${board.category }</category>
		</item>
	</c:forEach>
</pList>