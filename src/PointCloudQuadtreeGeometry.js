
var nodesLoadTimes = {};

Potree.PointCloudQuadtreeGeometry = function(){
	this.url = null;
	this.octreeDir = null;
	this.spacing = 0;
	this.boundingBox = null;
	this.root = null;
	this.numNodesLoading = 0;
	this.nodes = null;
	this.pointAttributes = null;
	this.hierarchyStepSize = -1;
	this.loader = null;
};

Potree.PointCloudQuadtreeGeometryNode = function(name, pcoGeometry, boundingBox){
	this.id = Potree.PointCloudQuadtreeGeometryNode.IDCount++;
	this.name = name;
	this.index = parseInt(name.charAt(name.length-1));
	this.pcoGeometry = pcoGeometry;
	this.geometry = null;
	this.boundingBox = boundingBox;
	this.boundingSphere = Potree.PointCloudQuadtreeGeometryNode.getModifiedBoundingBoxSphere(boundingBox);
	this.children = {};
	this.numPoints = 0;
	this.level = null;
	this.loaded = false;
	this.oneTimeDisposeHandlers = [];
};

Potree.PointCloudQuadtreeGeometryNode.getModifiedBoundingBoxSphere = function (boundingBox) {
    let min = boundingBox.min.clone();
    let max = boundingBox.max.clone();

    min.z = 1;
    max.z = 1;

    return new THREE.Box3(min, max).getBoundingSphere();
};

Potree.PointCloudQuadtreeGeometryNode.IDCount = 0;

Potree.PointCloudQuadtreeGeometryNode.prototype = Object.create(Potree.PointCloudTreeNode.prototype);

Potree.PointCloudQuadtreeGeometryNode.prototype.isGeometryNode = function(){
	return true;
};

Potree.PointCloudQuadtreeGeometryNode.prototype.getLevel = function(){
	return this.level;
};

Potree.PointCloudQuadtreeGeometryNode.prototype.isTreeNode = function(){
	return false;
};

Potree.PointCloudQuadtreeGeometryNode.prototype.isLoaded = function(){
	return this.loaded;
};

Potree.PointCloudQuadtreeGeometryNode.prototype.getBoundingSphere = function(){
	return this.boundingSphere;
};

Potree.PointCloudQuadtreeGeometryNode.prototype.getBoundingBox = function(){
	return this.boundingBox;
};

Potree.PointCloudQuadtreeGeometryNode.prototype.getChildren = function(){
	var children = [];
	
	for(var i = 0; i < 4; i++){
		if(this.children[i]){
			children.push(this.children[i]);
		}
	}
	
	return children;
};

Potree.PointCloudQuadtreeGeometryNode.prototype.getBoundingBox = function(){
	return this.boundingBox;
};

Potree.PointCloudQuadtreeGeometryNode.prototype.getURL = function(){
	var url = "";
	
	var version = this.pcoGeometry.loader.version;
	
	if(version.equalOrHigher("1.5")){
		url = this.pcoGeometry.octreeDir + "/" + this.getHierarchyPath() + "/" + this.name;
	}else if(version.equalOrHigher("1.4")){
		url = this.pcoGeometry.octreeDir + "/" + this.name;
	}else if(version.upTo("1.3")){
		url = this.pcoGeometry.octreeDir + "/" + this.name;
	}
	
	return url;
};

Potree.PointCloudQuadtreeGeometryNode.prototype.getHierarchyPath = function(){
	var path = "r/";

	var hierarchyStepSize = this.pcoGeometry.hierarchyStepSize;
	var indices = this.name.substr(1);
	
	var numParts = Math.floor(indices.length / hierarchyStepSize);
	for(var i = 0; i < numParts; i++){
		path += indices.substr(i * hierarchyStepSize, hierarchyStepSize) + "/";
	}
	
	path = path.slice(0,-1);

	return path;
};

Potree.PointCloudQuadtreeGeometryNode.prototype.addChild = function(child){
	this.children[child.index] = child;
	child.parent = this;
};

Potree.PointCloudQuadtreeGeometryNode.prototype.load = function(){
	if(this.loading === true || this.loaded === true ||this.pcoGeometry.numNodesLoading > 3){
		return;
	}
	
	this.loading = true;
	
	this.pcoGeometry.numNodesLoading++;
	
	
	if(this.pcoGeometry.loader.version.equalOrHigher("1.5")){
		if((this.level % this.pcoGeometry.hierarchyStepSize) === 0 && this.hasChildren){
			this.loadHierachyThenPoints();
		}else{
			this.loadPoints();
		}
	}else{
		this.loadPoints();
	}
	
	
};

Potree.PointCloudQuadtreeGeometryNode.prototype.loadPoints = function(){
	this.pcoGeometry.loader.load(this);
};


Potree.PointCloudQuadtreeGeometryNode.prototype.loadHierachyThenPoints = function(){

	var node = this;

	// load hierarchy
	var callback = function(node, hbuffer){
		var count = hbuffer.byteLength / 5;
		var view = new DataView(hbuffer);
		
		var stack = [];
		var children = view.getUint8(0);
		var numPoints = view.getUint32(1, true);
		node.numPoints = numPoints;
		stack.push({children: children, numPoints: numPoints, name: node.name});
		
		var decoded = [];
		
		var offset = 5;
		while(stack.length > 0){
		
			var snode = stack.shift();
			var mask = 1;
			for(var i = 0; i < 4; i++){
				if((snode.children & mask) !== 0){
					var childIndex = i;
					var childName = snode.name + i;
					
					var childChildren = view.getUint8(offset);
					var childNumPoints = view.getUint32(offset + 1, true);
					
					stack.push({children: childChildren, numPoints: childNumPoints, name: childName});
					
					decoded.push({children: childChildren, numPoints: childNumPoints, name: childName});
					
					offset += 5;
				}
				
				mask = mask * 2;
			}
			
			if(offset === hbuffer.byteLength){
				break;
			}
			
		}
		
		//console.log(decoded);
		
		var nodes = {};
		nodes[node.name] = node;
		var pco = node.pcoGeometry;
		
		
		for( var i = 0; i < decoded.length; i++){
			var name = decoded[i].name;
			var numPoints = decoded[i].numPoints;
			var index = parseInt(name.charAt(name.length-1));
			var parentName = name.substring(0, name.length-1);
			var parentNode = nodes[parentName];
			var level = name.length-1;
			var boundingBox = Potree.POCLoader.createChildAABBQuad(parentNode.boundingBox, index);
			
			var currentNode = new Potree.PointCloudQuadtreeGeometryNode(name, pco, boundingBox);
			currentNode.level = level;
			currentNode.numPoints = numPoints;
			currentNode.hasChildren = decoded[i].children > 0;
			currentNode.spacing = pco.spacing / Math.pow(2, level);
			parentNode.addChild(currentNode);
			nodes[name] = currentNode;
		}
		
		node.loadPoints();
		
	};
	if((node.level % node.pcoGeometry.hierarchyStepSize) === 0){
		//var hurl = node.pcoGeometry.octreeDir + "/../hierarchy/" + node.name + ".hrc";
		var hurl = node.pcoGeometry.octreeDir + "/" + node.getHierarchyPath() + "/" + node.name + ".hrc";
		
		var xhr = new XMLHttpRequest();
		xhr.open('GET', hurl, true);
		xhr.responseType = 'arraybuffer';
		xhr.overrideMimeType('text/plain; charset=x-user-defined');
		xhr.onreadystatechange = function() {
			if (xhr.readyState === 4) {
				if (xhr.status === 200 || xhr.status === 0) {
					var hbuffer = xhr.response;
					callback(node, hbuffer);
				} else {
					console.log('Failed to load file! HTTP status: ' + xhr.status + ", file: " + url);
				}
			}
		};
		try{
			xhr.send(null);
		}catch(e){
			console.log("fehler beim laden der punktwolke: " + e);
		}
	}

};


Potree.PointCloudQuadtreeGeometryNode.prototype.getNumPoints = function(){
	return this.numPoints;
};


Potree.PointCloudQuadtreeGeometryNode.prototype.dispose = function(){
	if(this.geometry && this.parent != null){
		this.geometry.dispose();
		this.geometry = null;
		this.loaded = false;
		
		//this.dispatchEvent( { type: 'dispose' } );
		for(var i = 0; i < this.oneTimeDisposeHandlers.length; i++){
			var handler = this.oneTimeDisposeHandlers[i];
			handler();
		}
		this.oneTimeDisposeHandlers = [];
	}
};

//THREE.EventDispatcher.prototype.apply( Potree.PointCloudQuadtreeGeometryNode.prototype );
Object.assign( Potree.PointCloudQuadtreeGeometryNode.prototype, THREE.EventDispatcher.prototype );