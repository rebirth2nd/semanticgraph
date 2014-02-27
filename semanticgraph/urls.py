from django.conf.urls import patterns, include, url

from django.contrib import admin
admin.autodiscover()

urlpatterns = patterns('',
# Examples:
    url(r'^graph/$', 'graph.views.centerNode'),
    # url(r'^mysite/', include('mysite.foo.urls')),
    url(r'^graph/(?P<query>\D+)/$', 'graph.views.network'),
    # Uncomment the admin/doc line below to enable admin documentation:
    # url(r'^admin/doc/', include('django.contrib.admindocs.urls')),

    # Uncomment the next line to enable the admin:
    url(r'^admin/', include(admin.site.urls)),
    # form submit
    url(r'^home/$', 'graph.views.search_form'),
    url(r'^contact/$', 'graph.views.Contact'),
    url(r'^terms/$', 'graph.views.Terms'),
    # Page shown after submission
    url(r'^search/$', 'graph.views.centerNode'),
    url(r'^ajaxsearch/$', 'graph.views.ajaxfunction'),
    url(r'^docssearch/$', 'graph.views.docsSearch'),
    url(r'^writeFile/$', 'graph.views.writeFile'),
)

handler404 = 'graph.views.my_custom_404_view'

handler500 = 'graph.views.my_custom_500_view'
