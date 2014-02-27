$(document).ready(function(){
    $('#visform').submit(function(){

        linkg.selectAll("line").remove();
        hullg.selectAll("path.hull").remove();
        nodeg.selectAll(".node").remove();
        showLoading();

        var thisdata = {};thisdata['q'] = $('#searchboxvalue').val();thisdata['radius'] = $('#parameterLayer').val();thisdata['browser'] = Object.keys(jQuery.browser)[0];
        thisdata['csrfmiddlewaretoken'] = $('input[name=csrfmiddlewaretoken]').val();
        if (randomStatus) thisdata['toRandom'] = 0;

        $.ajax({
            url: "/ajaxsearch/",
            type: "post",
            dataType: "json",
            data: thisdata,
            success: function(json){
                console.log(json);
                console.log('parameters' in json);
                console.log(json.parameters);

                if ('checker' in json) checker = eval(json.checker);
                if ('errormsg' in json) errormsg = jQuery.parseJSON(json.errormsg);
                if ('parameters' in json) parameters = jQuery.parseJSON(json.parameters) || json.parameters;

                if ('grouplabel' in json) grouplabel = jQuery.parseJSON(json.grouplabel);
                if ('center' in json) centerinfo = json.center;
                if ('nodeNotInPath' in json) pathinfo = json.nodeNotInPath;

                rawquery = parameters['rawquery'];
                document.title = "Invisom Results Page: " + rawquery;

                if ('jsondata' in json) {
                    data = jQuery.parseJSON(json.jsondata);
                } else {
                    data = null;
                }

                loadsvg();
            },
            error: function(xhr,errmsg,err) {
                alert(xhr.status + "wrong: " + xhr.responseText);
            }
        }); // Ajax reload svg end
        return false;
    }); // Form submission end

    $('#infobutton').click(function(){ $('#infocontainer').hide(); })

    var timeout = setTimeout(function(){closeWrite();}, 180000);;
    document.onmousemove = function(){ clearTimeout(timeout); };
}); // Document ready end
