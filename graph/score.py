from py2neo import rest
from py2neo.util import quote
def index_query(index, query, order=None):
    if order:
        uri = "{0}?query={1}&order={2}".format(index.__uri__, quote(query, ""), order)
        return [
            (index._content_type(item['self']), item['score'])
            for item in index._send(rest.Request(index._graph_db, "GET", uri)).body
        ]
    else:
        uri = "{0}?query={1}".format(index.__uri__, quote(query, ""))
        return [
            index._content_type(item['self'])
            for item in index._send(rest.Request(index._graph_db, "GET", uri)).body
        ]
