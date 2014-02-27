# Create your views here.

from django.http import HttpResponse, HttpResponseRedirect, Http404
from django.template import Context, loader, RequestContext
from django.shortcuts import render, render_to_response
from django import forms
import django.core.mail

import datetime
import time
import math
import pytz
import pprint

import semanticgraph.settings

from py2neo import neo4j, cypher
from score import index_query

import json
from random import randint
import ast

# Neo4j constructors
graph_db = neo4j.GraphDatabaseService("http://localhost:7474/db/data/")
entity_index = graph_db.get_or_create_index(neo4j.Node, "Entity", config={"type":"fulltext", "provider":"lucene"})

def writeFile(request):

    ipAddr = request.META.get('REMOTE_ADDR')
    filename = "/home/qingyuan/log/" + ipAddr

    writeObject = request.GET["log"]

    with open(filename,'a') as f:
        f.write(str(writeObject) + '\n')
    return HttpResponse("ok")

def docsSearch(request):

    ipAddr = request.META.get('REMOTE_ADDR')
    filename = "/home/qingyuan/log/" + ipAddr

    writeObject = request.GET["log"]

    with open(filename,'a') as f:
        f.write(str(writeObject) + '\n')

    if "n" in request.GET:
        nodeID = int(request.GET["ID"])
        query = "start n=node({clicked}) return n.docs"
        data, metadata = cypher.execute(graph_db, query, params={"clicked":nodeID})
        docsList = json.dumps(data[0][0])
    elif "r" in request.GET:
        startID = int(request.GET["startID"])
        endID = int(request.GET["endID"])
        query = "start n=node({startnode}), m=node({endnode}) match n-[r]-m where has(r.docs) return r.docs"
        data, metadata = cypher.execute(graph_db, query, params={"startnode":startID, "endnode":endID})
        docsList=[]
        if data:
            docsList = json.dumps(data[0][0])
    elif "sn" in request.GET:
        rawID = request.GET["ID"]
        nodeID = [int(x) for x in rawID.split(',')]
        query = "start n=node({clicked}) return n.docs"
        data, metadata = cypher.execute(graph_db, query, params={"clicked":nodeID})
        docsList = []
        for d in data:
            curDoc = ast.literal_eval(d[0])[0]
            docsList.append(curDoc)
        docsList = json.dumps(docsList)
    return HttpResponse(docsList, content_type='application/json')       

def ajaxfunction(request):
    nodeAttrList=[]
    checker = ''
    errormsg = ''
    nodeNotInPath=[]
    
    if "toRandom" in request.POST:
        radius = int(request.POST['radius'])
        nodeAttrList, relAttrList, grouplabel, center, rawquery = getRandomGraph(radius)
        parameters={"rawquery":rawquery, "radius":radius}
    elif "q" in request.POST:
        rawquery = str(request.POST['q'])
        radius = int(request.POST['radius'])
        parameters={"rawquery":rawquery, "radius":radius}
        termList = rawquery.split(';')
        dbQuery = ''
        idList=[]
        idtoname={}
        errorList=[]
        for tl in termList:
            tlProcessed = ' '.join( ['name_type:'+t for t in tl.split()] )
            dbList = index_query(entity_index, tlProcessed, 'score')
            # these two lines code were added by Zhu to replace those commented out above, meant to issue an "OR" form of query, so that "bill gates" can hit "gates".
            # interesing: after changing views.py, apache needs to be restarted for the change to take effect
            termTuple = [0,0,0,'']
            for dl in dbList:
                termScore=dl[1]
                termID=dl[0]._id
                termSig=dl[0].get_properties()['significance']
                termName=dl[0].get_properties()['name']
                if termScore > termTuple[1]:
                    termTuple = [termID, termScore, termSig, termName]
                elif termScore == termTuple[1] and termSig > termTuple[2]:
                    termTuple = [termID, termScore, termSig, termName]
            if termTuple[0] > 0:
                idList.append(termTuple[0])
                idtoname[termTuple[0]]=str(termTuple[3])
            else:
                errorList.append(tl)
        jsondata = ''
        if len(errorList) == 0:
            if len(idList) == 1:
                nodeAttrList, relAttrList, grouplabel, center = getSubGraph(idList[0], radius)
            elif len(idList) > 1:
                nodeAttrList, relAttrList, grouplabel, center, pathinfo = getPath(idList, radius)
                for pi in pathinfo:
                    nodeNotInPath.append(idtoname[pi])
        elif len(errorList) >= 1:
            if len(idList) == 0:
                checker="'NODENOTEXIST'"
            elif len(idList) == 1:
                nodeAttrList, relAttrList, grouplabel, center = getSubGraph(idList[0], radius)
                checker="'PARTNODENOTEXIST'"
            elif len(idList) > 1:
                nodeAttrList, relAttrList, grouplabel, center, pathinfo = getPath(idList, radius)
                #different checker and errormsg here
                for pi in pathinfo:
                    nodeNotInPath.append(idtoname[pi])
                checker="'PARTNODENOTEXIST'"
            errormsg=json.dumps(errorList)

    ipAddr = request.META.get('REMOTE_ADDR')
    filename = "/home/qingyuan/log/" + ipAddr

    writeObject = {}
    #writeObject["Browser"] = request.POST['browser']
    writeObject["Time"] = int(round(time.time() * 1000))
    writeObject["clientIP"] = ipAddr
    writeObject["query"] = rawquery

    with open(filename,'a') as f:
        f.write(str(writeObject) + '\n')

    if len(nodeAttrList) > 0:
        jsondata='{"nodes":' + json.dumps(nodeAttrList) + ', "links":' + json.dumps(relAttrList) + '}'
        label=json.dumps(grouplabel)
        parameters=json.dumps(parameters)
        c = {
             'jsondata': jsondata,
             'parameters': parameters,
             'grouplabel': label,
             'center': center,
             'checker': checker,
             'errormsg': errormsg,
             'nodeNotInPath': nodeNotInPath
        }
    else:
        c = {
             'checker': checker,
             'errormsg': errormsg,
             'parameters': parameters
        }
    if request.is_ajax():
        return HttpResponse(json.dumps(c), content_type='application/json')
    else:
        t = loader.get_template('visualize.html')
        return HttpResponse(t.render(RequestContext(request,c)))

def getRandomGraph(radius):
        countquery='start n=node(*) return count(*);'
        countdata, countmetadata = cypher.execute(graph_db, countquery)
        bound = countdata[0][0]
        selected = randint(1, bound)
        if radius == 1:
          randomquery='''start n=node({startnode}), w=node({startnode}) 
                         match n-[r?:REL*1..1]-m-[o?:SIM]-l, w-[j?:SIM]-k where (m.groupid = l.groupid or l is null) and (w.groupid = k.groupid or k is null) 
                         with collect(distinct last(r)) AS olinks, collect(distinct n) + filter(x in collect(distinct m): not x in collect(distinct n)) AS onodes, 
                         collect(distinct o) + filter(x in collect(distinct j): not x in collect(distinct o)) AS nlinks, 
                         collect(distinct l) + filter(x in collect(distinct k): not x in collect(distinct l)) AS nnodes with olinks + nlinks as totallinks, onodes, filter(x in nnodes: x.groupid > 0) as nonnodes 
                         return totallinks, onodes + filter(x in nonnodes: not x in onodes) as union'''
        elif radius == 2:
          randomquery='''start n=node({startnode}), w=node({startnode})
                         match n-[r?:REL*1..2]-m-[o?:SIM]-l, w-[j?:SIM]-k where (m.groupid = l.groupid or l is null) and (w.groupid = k.groupid or k is null)
                         with collect(distinct last(r)) AS olinks, collect(distinct n) + filter(x in collect(distinct m): not x in collect(distinct n)) AS onodes,
                         collect(distinct o) + filter(x in collect(distinct j): not x in collect(distinct o)) AS nlinks,
                         collect(distinct l) + filter(x in collect(distinct k): not x in collect(distinct l)) AS nnodes with olinks + nlinks as totallinks, onodes, filter(x in nnodes: x.groupid > 0) as nonnodes
                         return totallinks, onodes + filter(x in nonnodes: not x in onodes) as union'''
        elif radius == 3:
          randomquery='''start n=node({startnode}), w=node({startnode})
                         match n-[r?:REL*1..3]-m-[o?:SIM]-l, w-[j?:SIM]-k where (m.groupid = l.groupid or l is null) and (w.groupid = k.groupid or k is null)
                         with collect(distinct last(r)) AS olinks, collect(distinct n) + filter(x in collect(distinct m): not x in collect(distinct n)) AS onodes,
                         collect(distinct o) + filter(x in collect(distinct j): not x in collect(distinct o)) AS nlinks,
                         collect(distinct l) + filter(x in collect(distinct k): not x in collect(distinct l)) AS nnodes with olinks + nlinks as totallinks, onodes, filter(x in nnodes: x.groupid > 0) as nonnodes
                         return totallinks, onodes + filter(x in nonnodes: not x in onodes) as union'''
        randomdata, randommetadata = cypher.execute(graph_db, randomquery, params={"startnode":selected})
        nodeAttrList=[]
        relAttrList=[]
        centerinfo=[]
        nodeIDList=[]
        if len(randomdata) > 0:
            nodeList=randomdata[0][1]
            relList=randomdata[0][0]
            grouplabel={}
            centerNodeName=''
            for nl in nodeList:
                nodeAttr=nl.get_properties()
                curID=nl._id
                nodeAttr['id']=curID
                nodeIDList.append(curID)
                curGroupNum=nodeAttr['groupid']
                curScore=nodeAttr['significance']
                nodeAttr['group']=curGroupNum
                if curID==selected:
                    centerNodeName=str(nodeAttr['name'])
                    centerinfo=[[curID], [curGroupNum], [centerNodeName]]
                if curGroupNum in grouplabel.keys():
                    if curScore > grouplabel[curGroupNum][0]:
                        grouplabel[curGroupNum]=[curScore,str(nodeAttr['name'])]
                else:
                    grouplabel[curGroupNum]=[curScore,nodeAttr['name']]
                nodeAttrList.append(nodeAttr)
            for rl in relList:
                relAttr=rl.get_properties()
                startid=rl.start_node._id
                endid=rl.end_node._id
                relAttr['source']=startid
                relAttr['target']=endid
                thistype=rl.type
                relAttr['type']=thistype
                if startid in nodeIDList and endid in nodeIDList:
                    relAttrList.append(relAttr)
        return nodeAttrList, relAttrList, grouplabel, centerinfo, centerNodeName

def getPath(dbQuery, radius):    
        pathquery='''start n=node({startnode}), m=node({startnode}) 
                     match p=shortestPath(n-[r:REL*]-m) 
                     with extract(n in nodes(p): ID(n)) as pathnames where length(pathnames) > 1 
                     return pathnames;'''
        firstdata, firstmetadata = cypher.execute(graph_db, pathquery, params={"startnode": dbQuery})
        nodeByID=[]
        if len(firstdata) > 0:
            for d in firstdata:
                nodeByID+=d[0]
            nodeByID=list(set(nodeByID))

        nodeNotInPath=list(set(dbQuery)-set(nodeByID))
        nodeInMid=list(set(nodeByID)-set(dbQuery))
        centerlist=list(dbQuery)
        centerlist.extend(nodeInMid)

        if radius == 1:
            secondquery='''start n=node({startnode}), w=node({startnode}) 
                           match n-[r?:REL*1..1]-m-[o?:SIM]-l, w-[j?:SIM]-k 
                           where (m.groupid = l.groupid or l is null) and (w.groupid = k.groupid or k is null) 
                           with collect(distinct last(r)) AS olinks, collect(distinct n) + filter(x in collect(distinct m): not x in collect(distinct n)) AS onodes, 
                           collect(distinct o) + filter(x in collect(distinct j): not x in collect(distinct o)) AS nlinks, collect(distinct l) + filter(x in collect(distinct k): not x in collect(distinct l)) AS nnodes 
                           with olinks + nlinks as totallinks, onodes, filter(x in nnodes: x.groupid > 0) as nonnodes 
                           return totallinks, onodes + filter(x in nonnodes: not x in onodes) as union'''
        elif radius == 2:
            secondquery='''start n=node({startnode}), w=node({startnode})
                           match n-[r?:REL*1..2]-m-[o?:SIM]-l, w-[j?:SIM]-k
                           where (m.groupid = l.groupid or l is null) and (w.groupid = k.groupid or k is null)
                           with collect(distinct last(r)) AS olinks, collect(distinct n) + filter(x in collect(distinct m): not x in collect(distinct n)) AS onodes,
                           collect(distinct o) + filter(x in collect(distinct j): not x in collect(distinct o)) AS nlinks, collect(distinct l) + filter(x in collect(distinct k): not x in collect(distinct l)) AS nnodes
                           with olinks + nlinks as totallinks, onodes, filter(x in nnodes: x.groupid > 0) as nonnodes
                           return totallinks, onodes + filter(x in nonnodes: not x in onodes) as union'''
        elif radius == 3:
            secondquery='''start n=node({startnode}), w=node({startnode})
                           match n-[r?:REL*1..3]-m-[o?:SIM]-l, w-[j?:SIM]-k
                           where (m.groupid = l.groupid or l is null) and (w.groupid = k.groupid or k is null)
                           with collect(distinct last(r)) AS olinks, collect(distinct n) + filter(x in collect(distinct m): not x in collect(distinct n)) AS onodes,
                           collect(distinct o) + filter(x in collect(distinct j): not x in collect(distinct o)) AS nlinks, collect(distinct l) + filter(x in collect(distinct k): not x in collect(distinct l)) AS nnodes
                           with olinks + nlinks as totallinks, onodes, filter(x in nnodes: x.groupid > 0) as nonnodes
                           return totallinks, onodes + filter(x in nonnodes: not x in onodes) as union'''

        seconddata, secondmetadata = cypher.execute(graph_db, secondquery, params={"startnode":dbQuery})
        nodeAttrList=[]
        relAttrList=[]
        nodeIDList=[]
        centerinfo=[]
        expandGroup=[]
        foundNodeName=[]
        if len(seconddata) > 0:
            nodeList=seconddata[0][1]
            relList=seconddata[0][0]
            grouplabel={}
            for nl in nodeList:
                nodeAttr=nl.get_properties()
                curID=nl._id
                nodeAttr['id']=curID
                nodeIDList.append(curID);
                curGroupNum=nodeAttr['groupid']
                if curID in centerlist:
                    expandGroup.append(curGroupNum)
                    if curID in nodeByID:
                        foundNodeName.append(str(nodeAttr['name']))
                curScore=nodeAttr['significance']
                nodeAttr['group']=curGroupNum
                if curGroupNum in grouplabel.keys():
                    if curScore > grouplabel[curGroupNum][0]:
                        grouplabel[curGroupNum]=[curScore,str(nodeAttr['name'])]
                else:
                    grouplabel[curGroupNum]=[curScore,nodeAttr['name']]
                nodeAttrList.append(nodeAttr)
            for rl in relList:
                relAttr=rl.get_properties()
                startid=rl.start_node._id
                endid=rl.end_node._id
                relAttr['source']=startid
                relAttr['target']=endid
                thistype=rl.type
                relAttr['type']=thistype
                if startid in nodeIDList and endid in nodeIDList:
                    relAttrList.append(relAttr)
        expandGroup=list(set(expandGroup))
        centerinfo=[centerlist, expandGroup, foundNodeName]
        return nodeAttrList, relAttrList, grouplabel, centerinfo, nodeNotInPath

def getSubGraph(dbQuery,radius):

        if radius == 1:        
            query='''start n=node({startnode}), w=node({startnode}) 
                        match n-[r?:REL*1..1]-m-[o?:SIM]-l, w-[j?:SIM]-k 
                        where (m.groupid = l.groupid or l is null) and (w.groupid = k.groupid or k is null or w.groupid = 0) 
                        with collect(distinct last(r)) AS olinks, collect(distinct n) + filter(x in collect(distinct m): not x in collect(distinct n)) AS onodes, 
                        collect(distinct o) + filter(x in collect(distinct j): not x in collect(distinct o)) AS nlinks, collect(distinct l) + filter(x in collect(distinct k): not x in collect(distinct l)) AS nnodes 
                        with olinks + nlinks as totallinks, onodes, filter(x in nnodes: x.groupid > 0) as nonnodes 
                        return totallinks, onodes + filter(x in nonnodes: not x in onodes) as union'''
        elif radius == 2:
            query='''start n=node({startnode}), w=node({startnode})
                        match n-[r?:REL*1..2]-m-[o?:SIM]-l, w-[j?:SIM]-k
                        where (m.groupid = l.groupid or l is null) and (w.groupid = k.groupid or k is null or w.groupid = 0)
                        with collect(distinct last(r)) AS olinks, collect(distinct n) + filter(x in collect(distinct m): not x in collect(distinct n)) AS onodes,
                        collect(distinct o) + filter(x in collect(distinct j): not x in collect(distinct o)) AS nlinks, collect(distinct l) + filter(x in collect(distinct k): not x in collect(distinct l)) AS nnodes
                        with olinks + nlinks as totallinks, onodes, filter(x in nnodes: x.groupid > 0) as nonnodes
                        return totallinks, onodes + filter(x in nonnodes: not x in onodes) as union'''

        elif radius == 3:
            query='''start n=node({startnode}), w=node({startnode})
                        match n-[r?:REL*1..3]-m-[o?:SIM]-l, w-[j?:SIM]-k
                        where (m.groupid = l.groupid or l is null) and (w.groupid = k.groupid or k is null or w.groupid = 0)
                        with collect(distinct last(r)) AS olinks, collect(distinct n) + filter(x in collect(distinct m): not x in collect(distinct n)) AS onodes,
                        collect(distinct o) + filter(x in collect(distinct j): not x in collect(distinct o)) AS nlinks, collect(distinct l) + filter(x in collect(distinct k): not x in collect(distinct l)) AS nnodes
                        with olinks + nlinks as totallinks, onodes, filter(x in nnodes: x.groupid > 0) as nonnodes
                        return totallinks, onodes + filter(x in nonnodes: not x in onodes) as union'''

        data, metadata = cypher.execute(graph_db, query, params={"startnode":int(dbQuery)})    
        nodeAttrList=[]
        relAttrList=[]
        centerinfo=[]
        nodeIDList=[]
        if len(data) > 0:
            nodeList=data[0][1]
            relList=data[0][0]
            grouplabel={}
            for nl in nodeList:
                nodeAttr=nl.get_properties()
                curID=nl._id
                nodeAttr['id']=curID
                nodeIDList.append(curID);
                curGroupNum=nodeAttr['groupid']
                curScore=nodeAttr['significance']
                nodeAttr['group']=curGroupNum
                if curID==int(dbQuery):
                    centerNodeName=str(nodeAttr['name'])
                    centerinfo=[[curID], [curGroupNum], [centerNodeName]]
                else:
                    nodeAttr['docs']=[]
                if curGroupNum in grouplabel.keys():
                    if curScore > grouplabel[curGroupNum][0]:
                        grouplabel[curGroupNum]=[curScore,str(nodeAttr['name'])]
                else:
                    grouplabel[curGroupNum]=[curScore,nodeAttr['name']]
                nodeAttrList.append(nodeAttr)
            for rl in relList:
                relAttr=rl.get_properties()
                relAttr["docs"]=[]
                startid=rl.start_node._id
                endid=rl.end_node._id
                relAttr['source']=startid
                relAttr['target']=endid
                thistype=rl.type
                relAttr['type']=thistype
                if startid in nodeIDList and endid in nodeIDList:
                    relAttrList.append(relAttr)
        return nodeAttrList, relAttrList, grouplabel, centerinfo

def search_form(request):
    return render(request, 'index.html')

class ContactForm(forms.Form):
  subject = forms.CharField(max_length=100)
  message = forms.CharField()
  sender = forms.EmailField()
  cc_myself = forms.BooleanField(required=False)


def Contact(request):
  if request.method == 'POST': # If the form has been submitted...
    form = ContactForm(request.POST) # A form bound to the POST data
    if form.is_valid():
      subject = '[Invisdom Site] ' + form.cleaned_data['subject']
      message = form.cleaned_data['message']
      sender = form.cleaned_data['sender']
      cc_myself = form.cleaned_data['cc_myself']
      bcc_recipients = ['zhangqingyuan0011@gmail.com']
      recipients = []
      if cc_myself:
          recipients.append(sender)
      email = django.core.mail.EmailMessage(subject=subject, body=message,
          from_email=sender, to=recipients, bcc=bcc_recipients, headers =
          {'Reply-To': sender})
      email.send(fail_silently=False)
      return HttpResponseRedirect('/thanks/') # Redirect after POST
  else:
    form = ContactForm() # An unbound form
  return render(request, 'contact.html', {'form': form, })

def Thanks(request):
  return render_to_response('thanks.html',
      context_instance=RequestContext(request))

def Terms(request):
  return render_to_response('terms.html',
      context_instance=RequestContext(request))

def my_custom_404_view(request):
  return render_to_response('404.html',
      context_instance=RequestContext(request))

def my_custom_500_view(request):
  return render_to_response('500.html',
      context_instance=RequestContext(request))
