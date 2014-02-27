    	var bodywidth = $(document).width();
        var bodyheight = $(document).height();
        var width = bodywidth, // svg width
        height = bodyheight, // svg height
		
        dr = 4, // default point radius
        off = 15, // cluster hull offset

        gm, // group map
        nm, // node map
        lm, // link map
        gn, // previous group nodes
        gc, // previous group centroids        

        zoomFactor = 1,
        zoom = d3.behavior.zoom(),
        vis,expandGroup,doclist,
        randomStatus = false,
		
        expand = {}, // expanded clusters
	groupNum = [],
		
	sigMax = 0,
	sigScale,
		
	strMax,
	strScale,
	
	userNodeColor = "rgba(0, 128, 20, 0.6)",
	userLinkColor = "#008014",
	searchNodeColor = "rgba(0, 0, 225, 0.6)",
	searchLinkColor = "#0000e1",
	normalNodeColor = "#ffffff",
	normalLinkColor = "#333333",
        normalStrokeColor = "#555555",
        userStrokeColor = "#ff00ff",
	userLastClick = {},
		
	nodeFilterMin = 8,
	linkFilterMin = 0,
	nodeFilterMax = 16,
	linkFilterMax = 6,
	nodevalue = 0, // global variable to store the filter value
	linkvalue = 0,
		
	linkLog = [], // store user click history
	nodeLog = [],
		
	nodeSet = [],
	nodeTotal = [],
        linkTotal = [],

	curZoom = 0,
		
	textboxvalue = '',
	rawquery='',
        radius,parameters,safety,
        centerinfo,pathinfo,checker,errormsg,grouplabel,
        data, net, force, hullg, hull, linkg, link, nodeg, node; 
								  
    window.onload = function() { document.getElementById("searchboxvalue").focus();loadsvg(); };
	
    var curve = d3.svg.line()
                      .interpolate("cardinal-closed")
                      .tension(.85);
 
    var fill = d3.scale.category20();
 
    function nodeid(n) {
      return n.size ? "_g_"+n.group : n.id;
    }
 
    function linkid(l) {
      var u = nodeid(l.source),
          v = nodeid(l.target);
      return u<v ? u+"|"+v : v+"|"+u;
    }
 
    function getGroup(n) { return n.group; }
	
    // constructs the network to visualize
    function network(data, prev, getGroup, expand) {
      expand = expand || {};
      gm = {}, // group map
          nm = {}, // node map
          lm = {}, // link map
          gn = {}, // previous group nodes
          gc = {}, // previous group centroids
          nodes = [], // output nodes
          links = []; // output links
 
      // process previous nodes for reuse or centroid calculation
      if (prev) {
        prev.nodes.forEach(function(n) {
          var i = getGroup(n), o;
          if (n.size > 0) {
            gn[i] = n;
            n.size = 0;
            n.nodes = [];
            n.significance = 0;
            n.docs = [];
            n.names = [];
            n.ids = [];
          } else {
            o = gc[i] || (gc[i] = {x:0,y:0,count:0});
            o.x += n.x;
            o.y += n.y;
            o.count += 1;
          }
        });
      }
 
      // determine nodes
      for (var k=0; k<data.nodes.length; ++k) {
        var n = data.nodes[k],
            i = getGroup(n),
            l = gm[i] || (gm[i]=gn[i]) || (gm[i]={group:i, size:0, nodes:[], significance:0, docs:[], names:[], ids:[]});
 
        if (expand[i]) {
          // the node should be directly visible
          nm[nodeid(n)] = nodes.length;
          nodes.push(n);
          if (gn[i]) {
            // place new nodes at cluster location (plus jitter)
            n.x = gn[i].x + Math.random();
            n.y = gn[i].y + Math.random();
          }
        } else {
          // the node is part of a collapsed cluster
          if (l.size == 0) {
            // if new cluster, add to set and position at centroid of leaf nodes
            nm["_g_" + i] = nodes.length;
            nodes.push(l);
            if (gc[i]) {
              l.x = gc[i].x / gc[i].count;
              l.y = gc[i].y / gc[i].count;
            }
          }
          // pop up the old info at the right time
          l.nodes.push(n);
        }

        if (n.significance > l.significance) l.significance = n.significance;
        // pop up the old info at the right time
        l.names.push(n.name);
        l.ids.push(nodeid(n));
	// always count group size as we also use it to tweak the force graph strengths/distances
        l.size += 1;
	n.group_data = l;
         
      }
  
      for (i in gm) { gm[i].link_count = 0; }
 
      // determine links
      for (k=0; k<data.links.length; ++k) {
        var e = data.links[k],
            u = getGroup(e.source),
            v = getGroup(e.target);

	if (u != v) {
	    gm[u].link_count++;
	    gm[v].link_count++;
	}

        u = expand[u] ? nm[nodeid(e.source)] : nm["_g_" + u];
        v = expand[v] ? nm[nodeid(e.target)] : nm["_g_" + v];

        var i = (u<v ? u+"|"+v : v+"|"+u),
            l = lm[i] || (lm[i] = {source:u, target:v, size:0, significance:0, docs:[], pairs:[]});

        l.size += 1;
        l.pairs.push(e.source.id + ";" + e.target.id);
	if ('direction' in e) l.direction = e.direction;
        l.type = e.type;
	if (e.significance > l.significance) l.significance = e.significance;
	l.tfreq = e.tfreq;
	l.dfreq = e.dfreq;
        if ('score' in e) l.score = e.score;
      }
      
      for (i in lm) { links.push(lm[i]); }
 
      return {nodes: nodes, links: links};
    } // F-network end
	
    function convexHulls(nodes, getGroup, offset) {
          var hulls = {};
 
          // create point sets
          for (var k=0; k<nodes.length; ++k) {
            var n = nodes[k];
            if (n.size) continue;
            var i = getGroup(n),
                l = hulls[i] || (hulls[i] = []);
            l.push([n.x-offset, n.y-offset]);
            l.push([n.x-offset, n.y+offset]);
            l.push([n.x+offset, n.y-offset]);
            l.push([n.x+offset, n.y+offset]);
          }
 
          // create convex hulls
          var hullset = [];
          for (i in hulls) {
            if (i != 0) hullset.push({group: i, path: d3.geom.hull(hulls[i])});
          }

          return hullset;
    }
	
    function drawCluster(d) { return curve(d.path); }
 
    function redraw() { vis.attr("transform","translate(" + d3.event.translate + ")" + " scale(" + d3.event.scale + ")");}
	
    function init() {
  
      if (force) force.stop();
 
      net = network(data, net, getGroup, expand);
  
      force = d3.layout.force()
                       .nodes(net.nodes)
                       .links(net.links)
                       .size([width, height])
                       .linkDistance(function(l, i) {
	                       var n1 = l.source, n2 = l.target;
                                   if (l.type=="REL") {
                                   // larger distance for bigger groups:
                                   // both between single nodes and _other_ groups (where size of own node group still counts),
                                   // and between two group nodes.
                                   //
                                   // reduce distance for groups with very few outer links,
                                   // again both in expanded and grouped form, i.e. between individual nodes of a group and
                                   // nodes of another group or other group node or between two group nodes.
                                   //
                                   // The latter was done to keep the single-link groups close.
                                   return 21 +
                                               Math.min( 14 * Math.min( (n1.size || (n1.group != n2.group ? n1.group_data.size : 0)),
                                                                        (n2.size || (n1.group != n2.group ? n2.group_data.size : 0))
                                                                      ),
                                                         -21 + 21 * Math.min( (n1.link_count || (n1.group != n2.group ? n1.group_data.link_count : 0)),
                                                                              (n2.link_count || (n1.group != n2.group ? n2.group_data.link_count : 0))
                                                                            ),
                                                         100);
                                   } else if (l.type=="SIM") return -50;
	               })
	               .linkStrength(1)
	               .gravity(0.9) // gravity+charge tweaked to ensure good 'grouped' view (e.g. green group not smack between blue&orange, ...
	               .charge(function(d, i) {
                          //var centergroup = centerinfo[0];
                          //if (centergroup.indexOf(d.id) > -1) return -6000;
                          //else return -2000;
                          return -5500;
                       }) // ... charge is important to turn single-linked groups to the outside
	               .friction(0.6) // friction adjusted to get dampened display: less bouncy bouncy ball [Swedish Chef, anyone?]
	               .start();
	  
      // Append hull element to the SVG graph
      hullg.selectAll("path.hull").remove();
      hull = hullg.selectAll("path.hull")
                  .data(convexHulls(net.nodes, getGroup, off))
                  .enter().append("path")
                  .attr("class", "hull")
                  .attr("d", drawCluster)
                  .style("fill", function(d) { return fill(d.group); })
	          .style("fill-opacity", function() { return groupNum.length > 1? 0.3: 0; })
                  .on("dblclick", function(d) {
                         userRecordBeforeExpand();
			 expand[d.group] = false;
		         init();
                         var nodeList = [];
                         var thisid = "_g_" + d.group;
                         nodeList.push(thisid);
                         expandUpdateX(nodeList, 1);
                         d3.selectAll(".nodeCircle.super")
                           .filter(function(d) { return nodeid(d) == thisid; })
                           .attr("r", function(d) { return 2 * sigScale(d.significance); })
                           .transition()
                           .duration(1500)
                           .attr("r", function(d) { return sigScale(d.significance); });
	         });
  
      nodevalue = d3.select("#nodeslidervalue").property("value");		
      linkvalue = d3.select("#linkslidervalue").property("value");
  
      // Append link element to the SVG graph
      link = linkg.selectAll("line").data(net.links);
      link.exit().remove();
      link.enter()
          .append("line")
          .attr("cursor","pointer")
	  .attr("class", function(d) { return d.source.size || d.target.size ? "link super" : "link leaf"; })
	  .on("click", function(d) {
              // show infocontainer if hidden
              $('#infocontainer').show();   

	      var currentStroke = d3.select(this).style("stroke");
              if (currentStroke == "rgb(51, 51, 51)" || currentStroke == normalLinkColor) {
                  currentStroke = userLinkColor;
	      } else if (currentStroke == searchLinkColor || currentStroke == "rgb(0, 0, 225)"){
	          currentStroke = userLinkColor;
	      }	else {
                  if (nodeSet.indexOf(nodeid(d.source)) > -1 && nodeSet.indexOf(nodeid(d.target)) > -1) {
	              currentStroke = searchLinkColor;
		  } else { currentStroke = normalLinkColor; }
	      }
                				
	      d3.select(this).style("stroke", currentStroke);
				  
	      // Record the node id and click time when user click on one node
              linkLog.push( '{ "' + linkName(d) + '" : "' + new Date().getTime() + '" }');
				
              var linkClass = d3.select(this).attr("class");		
								
	      if (linkClass == "link leaf") {	
		  var headerinfo = "Relationship between " + "<b>" + d.source.name + "</b>" + " and " + "<b>" + d.target.name + "</b>" + "</br>";
               				    
                  var docsData = {};
                  docsData["r"] = true;
                  docsData["startID"] = d.source.id;
                  docsData["endID"] = d.target.id;
                  docsData["log"] = '{ "' + linkName(d) + '" : "' + new Date().getTime() + '" }';
                  displayDocs(docsData, headerinfo);
	      } else if (linkClass == "link super") {
                  var sourcename, targetname;
 
                  if (d.source.size) var sourcename = grouplabel[d.source.group][1];
                  else sourcename = d.source.name;

                  if (d.target.size) var targetname = grouplabel[d.target.group][1];
                  else targetname = d.target.name;

                  var docsData={};
                  docsData['r']=true;
                  var firstPair = d.pairs[0].split(";");
                  docsData["startID"] = firstPair[0];
                  docsData["endID"] = firstPair[1];
                  docsData["log"] = '{ "' + linkName(d) + '" : "' + new Date().getTime() + '" }';

                  var headerinfo = "Relationship between " + "<b>" + sourcename + "</b>" + " and " + "<b>" + targetname + "</b>" + "</br>";
                  displayDocs(docsData, headerinfo);
              }
          })
	  .on("dblclick", function(d) {
	      if (d3.select(this).attr("class") == "link super") {
	          userRecordBeforeExpand();
	          expand[d.source.group] = true;
		  expand[d.target.group] = true;
	          init();	   
                  expandUpdateX();
	      }
	  })
	  .on("mouseover", function(d, i){
              var linkUnderMouse = this; var hoverLink = d;

              if (nodeSet.indexOf(nodeid(d.source)) < 0 || nodeSet.indexOf(nodeid(d.target)) < 0) {
                  d3.select(this)
                    .style("stroke-width", function(d) { return 2 * strScale(d.significance); });
              }
						  
              d3.selectAll("line.link")
		.filter(function(d) {return this !== linkUnderMouse; })
                .attr("pointer-events", "none")
                .style("opacity", .1);
							
	      d3.selectAll(".node")
		.filter(function(d) {return nodeid(d) != nodeid(hoverLink.source) && nodeid(d) != nodeid(hoverLink.target); })
		.attr("pointer-events", "none")
                .style("opacity", .1);					 				 
	  })
	  .on("mouseout", function(d, i){
              var linkUnderMouse = this; var hoverLink = d;
						  
              if (nodeSet.indexOf(nodeid(d.source)) < 0 || nodeSet.indexOf(nodeid(d.target)) < 0) {
                  d3.select(this)
                    .style("stroke-width", function(d) { return strScale(d.significance); });
              }

              d3.selectAll("line.link")
		.filter(function(d) {return linkTotal.indexOf(linkid(d)) > -1 && this !== linkUnderMouse && strScale(d.significance) >= linkvalue; })
                .attr("pointer-events", "auto")
                .style("opacity", 1);
							
              d3.selectAll(".node")
		.filter(function(d, i) {return nodeTotal.indexOf(nodeid(d)) > -1 && nodeid(d) != nodeid(hoverLink.source) && nodeid(d) != nodeid(hoverLink.target) && sigScale(d.significance) >= nodevalue; })
                .attr("pointer-events", "auto")
                .style("opacity", 1);
	  });
 
  d3.selectAll("line.link.super")
    .style("stroke-width", function(d) { return strScale(d.significance); });
 
  d3.selectAll("line.link.leaf")
    .style("stroke-width", function(d) { return strScale(d.significance); });
 											 
  // Append node element to the SVG graph
  node = nodeg.selectAll(".node").data(net.nodes, nodeid);
  node.exit().remove();
 
  var node_drag = d3.behavior.drag()
        .on("dragstart", function(){force.stop();})
        .on("drag", dragmove)
        .on("dragend", dragend);

  function dragmove(d, i) {
      d.px = d.px + d3.event.dx;
      d.py = d.py + d3.event.dy;
      d.x = d.x + d3.event.dx;
      d.y = d.y + d3.event.dy;
      tick(); // this is the key to make it work together with updating both px,py,x,y on d !
  }

  function dragend(d, i) {
      d.fixed = true; // of course set the node to fixed so the force doesn't include the node in its auto positioning stuff
      tick();
      force.resume(); force.stop();
  }
 
  node.enter()
      .append("g")
      .attr("class", function(d) { return "node" + (d.size?" super":" leaf"); })
      .call(node_drag);
	  
  node.append("image")
      .attr("class", "nodeimage")
      .attr("id", function(d) { return "nodeimage" + " " + nodeid(d); } )
      .attr("xlink:href", function(d) { return imageByType[d.type]; })
      .attr("x", function(d) { return d.size? - dr - 1 : - sigScale(d.significance) ; } )
      .attr("y", function(d) { return d.size? - dr - 1 : - sigScale(d.significance) ; } )
      .attr("width", function(d) { return d.size? 2 * dr + 2 : 2 * sigScale(d.significance) ; } )
      .attr("height", function(d) { return d.size? 2 * dr + 2 : 2 * sigScale(d.significance) ; } );
  
  node.append("svg:circle")
      .attr("cursor", "pointer")
      .attr("class", function(d) { return "nodeCircle" + (d.size?" super":" leaf"); }) // d.size > 0 when d is a group node
      .attr("r", function(d) { return sigScale(d.significance); })
      .style("fill", function(d) { return d.size? "#ffffff" : fill(d.group); })
      .on("mouseover", function(d, i){
          // enlarge node circle when hover
          d3.select(this).transition().attr("r", function(d) { return 2 * sigScale(d.significance); });

          var thisid = nodeid(d);                      
          d3.selectAll(".nodeimage")
            .filter(function(d,i) { return d.id == thisid; })
            .transition()
            .attr("x", function(d) { return d.size? - 2 * dr - 2 : - 2 * sigScale(d.significance) ; } )
            .attr("y", function(d) { return d.size? - 2 * dr - 2 : - 2 * sigScale(d.significance) ; } )
            .attr("width", function(d) { return d.size? 4 * dr + 4 : 4 * sigScale(d.significance) ; } )
            .attr("height", function(d) { return d.size? 4 * dr + 4 : 4 * sigScale(d.significance) ; } );

	  var neighbor = {}; neighbor[thisid] = 1;
											 
	  d3.selectAll("line.link")
	    .filter(function(d) { return nodeid(d.source) != thisid && nodeid(d.target) != thisid; })
            .attr("pointer-events", "none")
            .style("opacity", .1);
		
									 
	  d3.selectAll("line.link")
	    .filter(function(d) {
	        return linkTotal.indexOf(linkid(d)) > -1 && strScale(d.significance) >= linkvalue && (nodeid(d.source) == thisid || nodeid(d.target) == thisid); })
	    .each(function(d) { 
                if (sigScale(d.source.significance) >= nodevalue) { neighbor[nodeid(d.source)] = 1; }
		if (sigScale(d.target.significance) >= nodevalue) { neighbor[nodeid(d.target)] = 1; }
	    });
											 
	  d3.selectAll("line.link.super")
	    .filter(function(d) { return linkTotal.indexOf(linkid(d)) > -1 && (nodeid(d.source) == thisid || nodeid(d.target) == thisid); })
	    .each(function(d) { neighbor[nodeid(d.source)] = 1; neighbor[nodeid(d.target)] = 1;});
											 
	  d3.selectAll(".node")
	    .filter(function(d) { return !(nodeid(d) in neighbor); })
	    .attr("pointer-events", "none")
            .style("opacity", .1);
      })
      .on("mouseout", function(d, i){

          d3.select(this).transition().attr("r", function(d) { return sigScale(d.significance); });
	  var thisid = nodeid(d);

          d3.selectAll(".nodeimage")
            .filter(function(d,i) { return d.id == thisid; })
            .transition()
            .attr("x", function(d) { return d.size? - dr - 1 : -sigScale(d.significance) ; } )
            .attr("y", function(d) { return d.size? - dr - 1 : -sigScale(d.significance) ; } )
            .attr("width", function(d) { return d.size? 2 * dr + 2 : 2 * sigScale(d.significance) ; } )
            .attr("height", function(d) { return d.size? 2 * dr + 2 : 2 * sigScale(d.significance) ; } );
											
          var neighbor = {}; neighbor[thisid] = 1;
											
	  d3.selectAll("line.link")
            .filter(function(d) {
		        return linkTotal.indexOf(linkid(d)) > -1 && (nodeid(d.source) == thisid || nodeid(d.target) == thisid); })
	    .each(function(d) {
                        if (sigScale(d.source.significance) >= nodevalue) { neighbor[nodeid(d.source)] = 1; }
			if (sigScale(d.target.significance) >= nodevalue) { neighbor[nodeid(d.target)] = 1; }
	    });
											 
	  d3.selectAll("line.link")
	    .filter(function(d) {
		        return linkTotal.indexOf(linkid(d)) > -1 && nodeid(d.source) != thisid && nodeid(d.target) != thisid && strScale(d.significance) >= linkvalue; })
	    .style("opacity", 1)
	    .attr("pointer-events", "auto");
				           						 
	  d3.selectAll(".node")
	    .filter(function(d) { return nodeTotal.indexOf(nodeid(d)) > -1 && sigScale(d.significance) >= nodevalue; })
	    .style("opacity", 1)
            .attr("pointer-events", "auto");
  });
										   
  d3.selectAll(".nodeCircle.leaf")
      .style("fill", normalNodeColor)
      .style("fill-opacity", 0)
      .on("click", function(d, i) {
           // show infocontainer if hidden           
           $('#infocontainer').show();

           var logName = d.name + "_" + d.type;
	   nodeLog.push( '{ "' + logName + '" : "' + new Date().getTime() + '" }');
  
           var opa = d3.select(this).style("fill-opacity");
           var currentFill = d3.select(this).style("fill");
           var highLight = nodeSet.indexOf(nodeid(d)) > -1;
		   
           if (opa == 0) {
	       d3.select(this).style("fill", userNodeColor)
		              .style("fill-opacity", 1);
           } else {
	       if (currentFill == searchNodeColor) {
	           d3.select(this).style("fill", userNodeColor)
			          .style("fill-opacity", 1);
	       } else if (currentFill == userNodeColor) {
			if (highLight) {
			    d3.select(this).style("fill", searchNodeColor)
				           .style("fill-opacity", 1);
	                } else {
			    d3.select(this).style("fill", normalNodeColor)
				           .style("fill-opacity", 0);
	                }
	       }
           }
		    
           var headerinfo = "<b>" + d.name + "</b>" + " is a " + "<b>" + d.type + "</b> entity" + "</br>";

           var docsData = {};
           docsData["n"] = true;
           docsData["ID"] = d.id;
           docsData["log"] = '{ "' + logName + '" : "' + new Date().getTime() + '" }';

           displayDocs(docsData,headerinfo);
      });
   
   d3.selectAll(".nodeCircle.super")
     .style("stroke-dasharray", "0,2 1")
     .style("stroke", "#555555")
     .on("click", function(d) {
          // show infocontainer if hidden
           $('#infocontainer').show();	  

	  nodeLog.push( '{ "' + nodeid(d) + '" : "' + new Date().getTime() + '" }');
				
	  var currentStroke = d3.select(this).style("stroke");
	  console.log(currentStroke);
	  currentStroke = currentStroke == normalStrokeColor ? userStrokeColor : normalStrokeColor;
	  
	  d3.select(this)
	    .style("stroke", currentStroke);
		
	  var groupNumber = d.group;
	  var nodeNum = d.size;
	  var linkNum = d.link_count;
          var nameList = d.names.slice(0, nodeNum).join(", ");
          var thisgroupname = grouplabel[groupNumber][1];
          var headerinfo = "The group " + "<b>" + thisgroupname + "</b>" + " contains the following entities:" + "</br>" + nameList + "</br>";
	  
	  var docsData = {};
          docsData["sn"]=true;
          docsData["ID"] = d.ids.join(",");
          var groupNameList = d.names.join(",");

          docsData["log"] = '{ "' + nodeid(d) + '" : "' + new Date().getTime() + '","groupNodes": "' + groupNameList + '"}';
          
          displayDocs(docsData, headerinfo);
				
	 })
     .on("dblclick", function(d) {
	        userRecordBeforeExpand();
                expand[d.group] = !expand[d.group];
		init();
		expandUpdate(d.ids, d.size);
     });
									   
	  
  d3.selectAll(".node.super")
    .append("text")
	 .attr("class", "super text")
     .attr("text-anchor", "middle")
	 .attr("font-family", "Times New Roman")
	 .attr("font-size", function(d) { return 20 + "px"} )
	 .attr("stroke-width", "0px")
         .attr("x", function(d) { return 10 + 3*(dr + d.size); })
	 .attr("y", function(d) { return -(dr + d.size); })
	 .attr("pointer-events","none")
	 .style("fill", "black")
     .text(function(d) {
       if (d.group == 0) return "Unknown";
       else { 
           var rawstr = grouplabel[d.group][1];
           var strlist = rawstr.split(" ");
           if (strlist.length <=2) return rawstr;
           else return strlist[0] + " " + strlist[1] + "...";
      }
      });
	  
  var leafNodeText = d3.selectAll(".node.leaf")
    .append("text")
	 .attr("class", "leaf text")
	 .attr("font-family", "Times New Roman")
	 .attr("font-size", function(d) { return 16 + "px"} )
	 .attr("stroke-width", "0px")
	 .attr("x", 12)
	 .attr("y", function(d) { return d.size / 3; })
	 .attr("pointer-events","none")
	 .attr("opacity", 1)
	 .style("fill", "black")
     .text(function(d) {
           var rawstr = d.name;
           var strlist = rawstr.split(" ");
           if (strlist.length <=2) return rawstr;
           else return strlist[0] + " " + strlist[1] + "...";
      });
	
    safety = 0;

    while (force.alpha() > 0.003) {
         force.tick();
         if (safety++ > 500) break;
    }

    //for (i=0; i<500; i++) { force.tick();}
    //force.on("tick", tick);
    tick();
    force.resume();
    force.stop();

} // F-init end
	
    function tick() {
        if (!hull.empty()) {
        hull.data(convexHulls(net.nodes, getGroup, off))
            .attr("d", drawCluster);
        }

        link.attr("x1", function(d) { return d.source.x; })
            .attr("y1", function(d) { return d.source.y; })
            .attr("x2", function(d) { return d.target.x; })
            .attr("y2", function(d) { return d.target.y; });

        node.attr("transform", function(d) { return "translate(" + d.x + "," + d.y + ")"; });
    } 
	
    function randomBuild() { randomStatus = true;};

    function normalSearch() { randomStatus = false;};
	
    function pathBuild() {
	  // Create binBox for final node set and link set
	  userLastClick = {};
								 
	  // Some resettings before subGraph extraction
								 
	  d3.selectAll(".nodeCircle.leaf")
	    .style("fill-opacity", 0);
		  
          d3.selectAll(".link.leaf")
            .style("stroke", normalLinkColor);
								 
	  document.getElementById("nodeslidervalue").value = nodeFilterMin;
          document.getElementById("linkslidervalue").value = linkFilterMin;
								 
          nodevalue = nodeFilterMin;
          linkvalue = linkFilterMin;
						
          // Display info of the centerNode or first node in the path		 								 
          d3.selectAll(".node.leaf")
            .filter(function(d) { return nodeSet[0] == nodeid(d); })
            .each(function(d) {
                var nodename = d.name;
                var doclist = d.docs;
                doclist = eval(doclist);
                var htmlcontent = "";
                                                  
                for (i=0; i< doclist.length; i++) {
                    var titleinfo = doclist[i].title_hl? doclist[i].title_hl : doclist[i].title;
                    var contentinfo = doclist[i].content_hl? doclist[i].content_hl : "";
                    htmlcontent += "<li><a onclick='writeFile(this);' href='" + doclist[i].url + "' target='_blank'>" + titleinfo + "</a>" + "</br>" + contentinfo + "</br>Date: " + doclist[i].date + "</li>";
                }
                                                                                   
                d3.select("p#infocontent").html( "<b>" + nodename + "</b>" + " is a " + "<b>" + d.type + "</b> entity" + "</br>"
                                   + "<h4>Related Articles: </h4><ul class='unstyled'>" + htmlcontent + "</ul>");                                                                            
          });
								 
	  d3.selectAll(".node.leaf")
	    .filter(function(d, i) { return nodeTotal.indexOf(nodeid(d)) <= -1; })
            .style("opacity", 0.1)
	    .attr("pointer-events", "none");
								   
	  d3.selectAll(".node.leaf")
	    .filter(function(d, i) { return nodeTotal.indexOf(nodeid(d)) > -1; })
            .style("opacity", 1)
	    .attr("pointer-events", "auto");
								 									 
	  d3.selectAll(".link.leaf")
	    .filter(function(d, i) { return linkTotal.indexOf(linkid(d)) <= -1; })
	    .style("opacity", 0.1)
	    .attr("pointer-events", "none");
								   
	  d3.selectAll(".link.leaf")
	    .filter(function(d, i) { return linkTotal.indexOf(linkid(d)) > -1; })
	    .style("opacity", 1)
	    .attr("pointer-events", "auto");
										 
	  d3.selectAll(".link.super")
	    .filter(function(d, i) { return linkTotal.indexOf(linkid(d)) <= -1; })
	    .style("opacity", 0.1)
	    .attr("pointer-events", "none");
										 
	  d3.selectAll(".link.super")
	    .filter(function(d, i) { return linkTotal.indexOf(linkid(d)) > -1; })
	    .style("opacity", 1)
	    .attr("pointer-events", "auto");
										 
	  d3.selectAll(".node.super")
	    .filter(function(d, i) { return nodeTotal.indexOf(nodeid(d)) <= -1; })
	    .style("opacity", 0.1)
	    .attr("pointer-events", "none");
										 
	  d3.selectAll(".node.super")
	    .filter(function(d, i) { return nodeTotal.indexOf(nodeid(d)) > -1; })
	    .style("opacity", 1)
	    .attr("pointer-events", "auto");
										 
	  d3.selectAll(".nodeCircle.leaf")
	    .filter(function(d, i) { return nodeSet.indexOf(nodeid(d)) > -1; })
            .transition()
	    .style("fill", searchNodeColor)
	    .style("fill-opacity", 1);					 				 
			
          d3.selectAll(".link.leaf")
            .filter(function(d) { return nodeSet.indexOf(nodeid(d.source)) > -1 && nodeSet.indexOf(nodeid(d.target)) > -1; })
            .style("stroke", searchLinkColor)
            .style("stroke-width", function(d) { return 20; })
            .style("stroke-dasharray", "0,2 1")
            .style("opacity", 1);

          d3.selectAll(".leaf.text")
            .filter(function(d) { return nodeSet.indexOf(nodeid(d)) > -1; })
            .attr("font-family", "Impact")
	    .attr("font-size", function(d) { return 30 + "px"} )
            .style("fill", "red");

          // Set screen focus to centerNode or physical center of path network
          var count = 0;
          for (i=0;i<net.nodes.length;i++) {
              var thisone=net.nodes[i];
              if (nodeSet.indexOf(nodeid(thisone)) > -1) count++;
          }
          refocus(nodeSet, count);                                            
        }; // F-pathBuild end
	
	function resetEverthing() {
        
		userLastClick = {};

		var count = 0;
                for (i=0;i<net.nodes.length;i++) {
                      var thisone=net.nodes[i];
                      if (nodeSet.indexOf(nodeid(thisone)) > -1) count++;
                }

                refocus(nodeSet, count); 
		
		document.getElementById("nodeslidervalue").value = nodeFilterMin;
		nodevalue = nodeFilterMin;
		
		document.getElementById("linkslidervalue").value = linkFilterMin;
		linkvalue = linkFilterMin;		
								 
		d3.selectAll(".node.leaf")
		  .filter(function(d, i) { return nodeTotal.indexOf(nodeid(d)) <= -1; })
		  .style("opacity", 0.1)
		  .attr("pointer-events", "none");
								   
		d3.selectAll(".node.leaf")
		  .filter(function(d, i) { return nodeTotal.indexOf(nodeid(d)) > -1; })
		  .style("opacity", 1)
		  .attr("pointer-events", "auto");
								 										 
		d3.selectAll(".link.leaf")
		  .filter(function(d, i) { return linkTotal.indexOf(linkid(d)) <= -1; })
		  .style("opacity", 0.1)
		  .attr("pointer-events", "none");
								   
		d3.selectAll(".link.leaf")
		  .filter(function(d, i) { return linkTotal.indexOf(linkid(d)) > -1; })
		  .style("opacity", 1)
		  .attr("pointer-events", "auto");
										 
		d3.selectAll(".link.super")
		  .filter(function(d, i) { return linkTotal.indexOf(linkid(d)) <= -1; })
                  .style("opacity", 0.1)
		  .attr("pointer-events", "none");
										 
		d3.selectAll(".link.super")
		  .filter(function(d, i) { return linkTotal.indexOf(linkid(d)) > -1; })
		  .style("opacity", 1)
		  .attr("pointer-events", "auto");
										 
		d3.selectAll(".node.super")
		  .filter(function(d, i) { return nodeTotal.indexOf(nodeid(d)) <= -1; })
	          .style("opacity", 0.1)
		  .attr("pointer-events", "none");
										 
		d3.selectAll(".node.super")
		  .filter(function(d, i) { return nodeTotal.indexOf(nodeid(d)) > -1; })
		  .style("opacity", 1)
		  .attr("pointer-events", "auto");
		  
		d3.selectAll(".nodeCircle.leaf")
		  .filter(function(d, i) { return nodeSet.indexOf(nodeid(d)) > -1; })
		  .style("fill", searchNodeColor)
		  .style("fill-opacity", 1);
		  
		d3.selectAll(".nodeCircle.leaf")
		  .filter(function(d, i) { return nodeSet.indexOf(nodeid(d)) < 0; })
                  .style("fill", normalNodeColor)
		  .style("fill-opacity", 0);
		  
                d3.selectAll(".nodeCircle.super").style("stroke", normalStrokeColor);

		d3.selectAll(".link")
                  .filter(function(d) { return linkTotal.indexOf(linkid(d)) > -1; })
		  .style("stroke", normalLinkColor);
		
		d3.selectAll(".link.leaf")
		  .filter(function(d) { return nodeSet.indexOf(nodeid(d.source)) > -1 && nodeSet.indexOf(nodeid(d.target)) > -1; })
		  .style("stroke", searchLinkColor)
		  .style("opacity", 1);
		
		if (groupNum.length == 1) force.stop();
    }; // F-resetEverything end
	
	function nodeFilter() {
		
		nodevalue = d3.select("#nodeslidervalue").property("value");
		
                linkvalue = d3.select("#linkslidervalue").property("value");
		
		console.log("Node filter: " + nodevalue);
		console.log("Link filter: " + linkvalue);
							
		d3.selectAll("line.link")
		  .filter(function(d) {return linkTotal.indexOf(linkid(d)) > -1 && strScale(d.significance) < linkvalue; })
                  .style("opacity", .1)
		  .attr("pointer-events","none");
							
		d3.selectAll("line.link")
		  .filter(function(d) {return linkTotal.indexOf(linkid(d)) > -1 && strScale(d.significance) >= linkvalue; })
                  .style("opacity", 1)
		  .attr("pointer-events","auto");
		
		d3.selectAll(".node")
		  .filter(function(d, i) {return nodeTotal.indexOf(nodeid(d)) > -1 && sigScale(d.significance) < nodevalue; })
		  .style("opacity", .1)
		  .attr("pointer-events","none");
							
		d3.selectAll(".node")
		  .filter(function(d, i) {return nodeTotal.indexOf(nodeid(d)) > -1 && sigScale(d.significance) >= nodevalue; })
		  .style("opacity", 1)
		  .attr("pointer-events","auto");
							
	  }; // F-nodeFilter end
  
	  function expandUpdate(nodeList, lsize) {

                         refocus(nodeList, lsize);

	                 d3.selectAll(".nodeCircle.leaf")
		           .filter(function(d, i) { return nodeSet.indexOf(nodeid(d)) > -1; })
		           .style("fill", searchNodeColor)
		           .style("fill-opacity", 1);
		  
			 d3.selectAll(".link")
                           .filter(function(d) { return nodeSet.indexOf(nodeid(d.source)) > -1 && nodeSet.indexOf(nodeid(d.target)) > -1; })
                           .style("stroke", searchLinkColor)
                           .style("stroke-width", function(d) { return 20; })
                           .style("stroke-dasharray", "0,2 1")
                           .style("opacity", 1);
		                 
		 						   
                         d3.selectAll(".link.leaf")
			   .filter(function(d, i) { return linkTotal.indexOf(linkid(d)) <= -1; })
			   .style("opacity", 0.1)
			   .attr("pointer-events", "none");
										 
			 d3.selectAll(".link.leaf")
			   .filter(function(d, i) { return linkTotal.indexOf(linkid(d)) > -1; })
			   .transition()
			   .style("opacity", 1)
			   .attr("pointer-events", "auto");
                                
			 d3.selectAll("line.link.super")
		           .filter(function(d) { return linkTotal.indexOf(linkid(d)) < 0; })
			   .style("opacity", .1)
			   .attr("pointer-events","none");
							
		         nodeFilter();
						 
			 d3.selectAll(".nodeCircle.leaf")
			   .filter(function(d) { return userLastClick[nodeid(d)] == 1; })
			   .style("fill", userNodeColor)
			   .style("fill-opacity", 1);
			 
                         d3.selectAll(".link")
			   .filter(function(d) { return userLastClick[linkid(d)] == 1; })
			   .style("stroke", userLinkColor);
    
                         d3.selectAll("line.link.super")
                           .filter(function(d) { return linkTotal.indexOf(linkid(d)) >=0; })
                           .style("opacity", 1)
                           .attr("pointer-events","auto");

                         d3.selectAll(".leaf.text")
                                                                  .filter(function(d) { return nodeSet.indexOf(nodeid(d)) > -1; })
                                                                  .attr("font-family", "Impact")
                                                                  .attr("font-size", function(d) { return 30 + "px"} )
                                                                  .style("fill", "red");
                         d3.selectAll(".super.text")
                                                                  .filter(function(d) { return nodeSet.indexOf(nodeid(d)) > -1; })
                                                                  .attr("font-family", "Impact")
                                                                  .attr("font-size", function(d) { return 30 + "px"} )
                                                                  .style("fill", "red");
	  } // F-expandUpdate end
	  
	  function userRecordBeforeExpand() {
			   
			   d3.selectAll(".nodeCircle.leaf")
		         .filter(function(d, i) { return d3.select(this).style("fill-opacity") == 1 && d3.select(this).style("fill") == userNodeColor ; })
		         .each(function(d) { userLastClick[nodeid(d)] = 1; });
				 
			   d3.selectAll(".nodeCircle.leaf")
		         .filter(function(d, i) { return d3.select(this).style("fill-opacity") != 1 || d3.select(this).style("fill") != userNodeColor ; })
		         .each(function(d) { userLastClick[nodeid(d)] = 0; });
				 
			   d3.selectAll(".link")
			     .filter(function(d, i) { return d3.select(this).style("stroke") == userLinkColor})
				 .each(function(d) { userLastClick[linkid(d)] = 1; });
				 
			   d3.selectAll(".link")
			     .filter(function(d, i) { return d3.select(this).style("stroke") != userLinkColor})
				 .each(function(d) { userLastClick[linkid(d)] = 0; });
	  }

          function expandUpdateX(nodeList, lsize) {
		         
                         refocus(nodeList, lsize);
        		   
                         d3.selectAll(".link.leaf")
			   .filter(function(d, i) { return linkTotal.indexOf(linkid(d)) <= -1; })
			   .style("opacity", 0.1)
			   .attr("pointer-events", "none");
										 
			 d3.selectAll(".link.leaf")
			   .filter(function(d, i) { return linkTotal.indexOf(linkid(d)) > -1; })
			   .transition()
			   .style("opacity", 1)
			   .attr("pointer-events", "auto");
                                
			 d3.selectAll("line.link.super")
		           .filter(function(d) { return linkTotal.indexOf(linkid(d)) < 0; })
			   .style("opacity", .1)
			   .attr("pointer-events","none");
							
			 nodeFilter();
						 
			 d3.selectAll(".nodeCircle.leaf")
			   .filter(function(d) { return userLastClick[nodeid(d)] == 1; })
			   .style("fill", userNodeColor)
			   .style("fill-opacity", 1);
						   
			 d3.selectAll(".link")
			   .filter(function(d) { return userLastClick[linkid(d)] == 1; })
			   .style("stroke", userLinkColor);
    
                         d3.selectAll("line.link.super")
                           .filter(function(d) { return linkTotal.indexOf(linkid(d)) >=0; })
                           .style("opacity", 1)
                           .attr("pointer-events","auto");

                         d3.selectAll(".nodeCircle.leaf")
                                   .filter(function(d, i) { return nodeSet.indexOf(nodeid(d)) > -1; })
                                   .style("fill", searchNodeColor)
                                   .style("fill-opacity", 1);

                         d3.selectAll(".link")
                               .filter(function(d) { return nodeSet.indexOf(nodeid(d.source)) > -1 && nodeSet.indexOf(nodeid(d.target)) > -1; })
                               .style("stroke", searchLinkColor)
                               .style("stroke-width", function(d) { return 20; })
                               .style("stroke-dasharray", "0,2 1")
                               .style("opacity", 1);                  

                         d3.selectAll(".leaf.text")
                                                                  .filter(function(d) { return nodeSet.indexOf(nodeid(d)) > -1; })
                                                                  .attr("font-family", "Impact")
                                                                  .attr("font-size", function(d) { return 30 + "px"} )
                                                                  .style("fill", "red");

                         d3.selectAll(".super.text")
                                                                  .filter(function(d) { return nodeSet.indexOf(nodeid(d)) > -1; })
                                                                  .attr("font-family", "Impact")
                                                                  .attr("font-size", function(d) { return 30 + "px"} )
                                                                  .style("fill", "red");
	  } // F-expandUpdateX end

          function refocus(nodeList, lsize) {
                  var thisX = 0, thisY = 0;

                  d3.selectAll(".node")
                    .filter(function(d) { return nodeList.indexOf(nodeid(d)) > -1; })
                    .each(function(d) {
                           console.log(d.name + ": " + d.x + "," + d.y);
                           thisX = thisX + d.x;
                           thisY = thisY + d.y;
                    });

                  console.log(thisX + ", " + thisY);
                  var pinjunX = thisX / lsize;
                  var pinjunY = thisY / lsize;

                  var distanceMax = 0;

                  d3.selectAll(".node")
                    .filter(function(d) { return nodeList.indexOf(nodeid(d)) > -1; })
                    .each(function(d) {
                          var distanceCur = Math.sqrt(Math.pow((d.x - pinjunX), 2) + Math.pow((d.y - pinjunY), 2));
                         
                          if (distanceCur > distanceMax) distanceMax = distanceCur;

                          console.log("Curr Max: " + distanceMax);
                  });

                  curZoom = (height / 2) / distanceMax; 

                  if (curZoom > 1) curZoom = 1;

                  console.log(pinjunX + ", " + pinjunY);
                  var shiftX = -pinjunX * curZoom + width / 2;
                  var shiftY = -pinjunY * curZoom + height / 2;

                  console.log(shiftX + ", " + shiftY);

                  vis.attr("transform","translate(" + shiftX + "," + shiftY + ")" + " scale(" + curZoom + ")");
                  zoom.scale(curZoom);
                  zoom.translate([shiftX, shiftY]);
          } // F-refocus end

          function showMessage() {
              if (checker == null || checker == "") {
                  if (pathinfo.length == 0)
                      document.getElementById("msgvalue").innerHTML="The following entities are successfully found: " + centerinfo[2].join(", ")
                       + "  |  " + "<b>" + data.nodes.length + "</b>" + " nodes and " + "<b>" + data.links.length + "</b>" + " links have been retrieved!";
                  else {
                      if (centerinfo[2].length > 0)
                          document.getElementById("msgvalue").innerHTML="The following entities are successfully found: " + centerinfo[2].join(", ")
                          + "  |  " + "The following entities are not connected in the graph: " + pathinfo.join(", ")
                          + "  |  " + "<b>" + data.nodes.length + "</b>" + " nodes and " + "<b>" + data.links.length + "</b>" + " links have been retrieved!";
                      else
                          document.getElementById("msgvalue").innerHTML="The following entities are successfully found: " + pathinfo.join(", ")
                          + "  |  " + "The following entities are not connected in the graph: " + pathinfo.join(", ")
                          + "  |  " + "<b>" + data.nodes.length + "</b>" + " nodes and " + "<b>" + data.links.length + "</b>" + " links have been retrieved!";
                  }
              }
              else if (checker == 'NODENOTEXIST') {
                  document.getElementById("msgvalue").innerHTML="The following entities are not found: " + errormsg.join(", ");
              } else if (checker == 'PARTNODENOTEXIST') {
                  if (pathinfo.length==0) {
                      document.getElementById("msgvalue").innerHTML="The following entities are successfully found: " + centerinfo[2].join(", ")
                      + "  |  " + "The following entities are not found: " + errormsg.join(", ")
                      + "  |  " + "<b>" + data.nodes.length + "</b>" + " nodes and " + "<b>" + data.links.length + "</b>" + " links have been retrieved!";
                  } else {
                      document.getElementById("msgvalue").innerHTML="The following entities are successfully found: " + centerinfo[2].join(", ")
                      + "  |  " + "The following entities are not found: " + errormsg.join(", ")
                      + "  |  " + "The following entities are not connected in the graph: " + pathinfo.join(", ")
                      + "  |  " + "<b>" + data.nodes.length + "</b>" + " nodes and " + "<b>" + data.links.length + "</b>" + " links have been retrieved!";
                  }
              }
          } // F-showMessage end

function showLoading() {
    if(document.getElementById) {
       (document.getElementById("loading_img")).style.visibility="visible";
    }
}

function hideLoading() {
    if(document.getElementById) {
       (document.getElementById("loading_img")).style.visibility="hidden";
    }
}

function createGraph() {
     // Fill the form with parameters to help user stay on track
     rawquery = parameters['rawquery'];
     radius = parameters['radius'];
     document.getElementById("searchboxvalue").value = rawquery;
     document.getElementById("parameterLayer").value = radius;

     // make it so we can lookup nodes in O(1)
     hash_lookup = [];
     data.nodes.forEach(function(d, i) { hash_lookup[d.id] = d; });
     data.links.forEach(function(d, i) {
         d.source = hash_lookup[d.source];
         d.target = hash_lookup[d.target];
     });

     zoom = d3.behavior.zoom();

     vis = d3.select("#svgcontainer")
             .append("svg")
             .attr("id", "svggraph")
             .style("overflow", "hidden")
             .attr("viewBox", "0 0 " + width + " " + height ) //better to keep the viewBox dimensions with variables
             .attr("preserveAspectRatio", "xMidYMid meet")
             .call(zoom.on("zoom", redraw)).on("dblclick.zoom", null) // adding a zoom behavior the the whole svg graph
             .append('svg:g');

     hullg = vis.append("g");
     linkg = vis.append("g");
     nodeg = vis.append("g");
          
     // Map significance value to node/rel size value
     sigMax = 0;
     data.nodes.forEach(function(d, i) {
         if (d.significance > sigMax) { sigMax = d.significance; };
     });
     sigScale = d3.scale.log(1000)
                        .domain([1, sigMax])
                        .range([8, 16]);

     strMax = 0;
     data.links.forEach(function(d, i) {
         if (d.type == "REL") { if (d.significance > strMax) { strMax = d.significance; }; }
     });
     strScale = d3.scale.log(1000)
                        .domain([1, strMax])
                        .range([0.5, 4]);

     // Build the nodeTotal reference ID set
     groupNum = Object.keys(grouplabel); // Object.keys() method returns an array of a given object's own enumerable properties
     data.nodes.forEach(function(d, i) { nodeTotal.push(nodeid(d)); });
     for(i=0; i<groupNum.length; i++) { nodeTotal.push("_g_" + groupNum[i]); }

     // Build the linkTotal reference ID set
     data.links.forEach(function(d) {
         if ( d.type == 'REL') {
            linkTotal.push(linkid(d));
            var u = "_g_"+d.source.group, v = "_g_"+d.target.group,
                u1 = nodeid(d.target), v1 = nodeid(d.source),
                superSuper = u+"|"+v, Supersuper = v+"|"+u;
            linkTotal.push(u+"|"+u1); linkTotal.push(u1+"|"+u);
            linkTotal.push(v+"|"+v1); linkTotal.push(v1+"|"+v);
            if (linkTotal.indexOf(superSuper) < 0) linkTotal.push(superSuper);
            if (linkTotal.indexOf(Supersuper) < 0) linkTotal.push(Supersuper);
     }});

     // Build the core nodeSet and related groups
     nodeSet = centerinfo[0]; expandGroup = centerinfo[1];

     expand={}; // reset the expanded supernode set every time a new query is made
     expand[0] = true; // Non-clustered nodes in cluster 0 is always expanded

     for (i=0;i<expandGroup.length;i++) {
           expand[expandGroup[i]] = true;
           nodeSet.push("_g_" + expandGroup[i]);
     }

     init(); // graph layout calculation
     pathBuild(); // set graph visual looks
} // F-createGraph end

function loadsvg() {

    if (data == null) { // createGraph not triggered
              document.getElementById("searchboxvalue").value = parameters['rawquery'];
              document.getElementById("parameterLayer").value = parameters['radius'];
    } else {
        showMessage(); createGraph();
    }
    hideLoading();
} // F-loadsvg end

function displayDocs(docsData, headerinfo) {
           $.ajax({                
                url: "/docssearch/",
                dataType: "json",
                data: docsData,
                success: function(json){
                        if (json == null) d3.select("p").html( headerinfo + "<h4>Related Articles Not Available!</h4>")
                        else {
                             if (typeof json === "string") doclist = jQuery.parseJSON(json);
                             else doclist = json;
                             var htmlcontent = "";
                             for (i=0; i< doclist.length; i++) {
                                 var titleinfo = doclist[i].title_hl? doclist[i].title_hl : doclist[i].title;
                                 var contentinfo = doclist[i].content_hl? doclist[i].content_hl : "";
                                 htmlcontent += "<li><a onclick='writeFile(this);' href='" + doclist[i].url + "' target='_blank'>" + titleinfo + "</a></br>" + contentinfo + "</br>Date: " + doclist[i].date + "</li>";
                             }
                             d3.select("p#infocontent").html( headerinfo + "<h4>Related Articles: </h4><ul class='unstyled'>" + htmlcontent + "</ul>");
                       }
                },
                error: function(xhr,errmsg,err) { alert(xhr.status + "wrong: " + xhr.responseText);}
           });
} // F-displayDocs end

function linkName(d) {
    var sourceinfo = d.source.size ? nodeid(d.source) : d.source.name + "_" + d.source.type;
    var targetinfo = d.target.size ? nodeid(d.target) : d.target.name + "_" + d.target.type;

    return sourceinfo + "|" + targetinfo;
}

function writeFile(d) {  
    var urlLog = "{" + d.href + ": " + new Date().getTime() + "}";
        $.ajax({
            url:"/writeFile/",
            dataType:"json",
            data:{"log":urlLog}
        });
}

function containLink(links, id) {
    for (i=0; i<links.length; i++) {
        var u=links[i].source;
        var v=links[i].target;

        var uv=nodeid(u) + "|" + nodeid(v);
        var vu=nodeid(v) + "|" + nodeid(u);

        if (id === uv || id === vu) return true;    
    }
    return false;
}

// Incomplete or unused functions dustbin

function checkQuery() {
          textboxvalue = document.getElementById("searchboxvalue").value.trim().toLowerCase();
          if (textboxvalue != rawquery) { searchbox.attr("onSubmit", "return true;");}
          else { return pathBuild(); }
    };

function pathCreation(e) {
          var event = e;
          var charCode = event.which || event.keyCode || event.charCode;
          if ( charCode == '13' ) { // Enter pressed
              checkQuery();
          }
};
