// declare global: diff_match_patch, DIFF_INSERT, DIFF_DELETE, DIFF_EQUAL
(function (window,$) {
    "use strict";
    var Pos = function (line, ch) {
        if (!(this instanceof Pos)) return new Pos(line, ch);
        this.line = line;
        this.ch = ch;
    };
    var svgNS = "http://www.w3.org/2000/svg";
    var Document = ace.require('ace/document').Document;
    var Range = ace.require("ace/range").Range;

    function DiffView(mv, type) {
        this.mv = mv;
        this.type = type;
        this.classes = type == "left"
            ? {chunk: "ace-merge-l-chunk",
            start: "ace-merge-l-chunk-start",
            end: "ace-merge-l-chunk-end",
            emptystart: "ace-merge-l-chunk-emptystart",
            emptyend: "ace-merge-l-chunk-emptyend",
            startend: "ace-merge-l-chunk-startend",
            insert: "ace-merge-l-inserted",
            del: "ace-merge-l-deleted",
            connect: "ace-merge-l-connect"}
            : {chunk: "ace-merge-r-chunk",
            start: "ace-merge-r-chunk-start",
            end: "ace-merge-r-chunk-end",
            startend: "ace-merge-r-chunk-startend",
            emptystart: "ace-merge-r-chunk-emptystart",
            emptyend: "ace-merge-r-chunk-emptyend",
            insert: "ace-merge-r-inserted",
            del: "ace-merge-r-deleted",
            connect: "ace-merge-r-connect"};
    }

    DiffView.prototype = {
        constructor: DiffView,
        init: function (pane, orig, options) {

            this.edit = this.mv.edit;
            this.orig = ace.edit(pane);
            this.orig.getSession().setMode('ace/mode/'+options.mode);
            this.orig.getSession().setValue(orig);
            this.orig.setReadOnly(true);
            this.orig.setShowFoldWidgets(false);
            this.orig.resize(true); //强制edit渲染
            this.diff = getDiff(asString(orig), asString(options.value));
            this.diffOutOfDate = false;
            this.lineHeight = $('.ace_line',this.mv.node).height();
            this.orig.pane = pane;

            registerUpdate(this);
            setScrollLock(this, true, false);
            registerScroll(this);
        }
    };

    function ensureDiff(dv) {
        if (dv.diffOutOfDate) {
            dv.diff = getDiff(dv.orig.getValue(), dv.edit.getValue());
            dv.diffOutOfDate = false;
        }
    }

    function registerUpdate(dv) {
        var edit = {from: 0, to: 0, marked: [], gutter: []};
        var orig = {from: 0, to: 0, marked: [], gutter: []};
        var debounceChange;

        function update() {
            ensureDiff(dv);

            updateMarks(dv.edit, dv.diff, edit, DIFF_INSERT, dv.classes);
            updateMarks(dv.orig, dv.diff, orig, DIFF_DELETE, dv.classes);

            makeConnections(dv);
        }

        function set(slow) {
            clearTimeout(debounceChange);
            debounceChange = setTimeout(update, slow == true ? 250 : 100);
        }

        function change() {
            if (!dv.diffOutOfDate) {
                dv.diffOutOfDate = true;
                edit.from = edit.to = orig.from = orig.to = 0;
            }
            set(true);
        }

        dv.edit.on("change", change);
        dv.orig.on("change", change);
        update();
    }

    function registerScroll(dv) {
        dv.edit.getSession().on("changeScrollTop", function () {
            if($('.ace_scrollbar-v',dv.orig.pane).css('display')!="none"){
                syncScroll(dv, DIFF_INSERT,'top')
            }
            makeConnections(dv);
        });
        dv.orig.getSession().on("changeScrollTop", function () {
            if($('.ace_scrollbar-v',dv.edit.pane).css('display')!="none"){
                syncScroll(dv, DIFF_DELETE,'top')
            }
            makeConnections(dv);
        });
        dv.edit.getSession().on("changeScrollLeft", function () {
            if($('.ace_scrollbar-h',dv.orig.pane).css('display')!="none"){
                syncScroll(dv, DIFF_INSERT,'left');
            }

        });
        dv.orig.getSession().on("changeScrollLeft", function () {
            if($('.ace_scrollbar-h',dv.edit.pane).css('display')!="none"){
                syncScroll(dv, DIFF_DELETE,'left');
            }

        });
    }

    function syncScroll(dv, type, dir) {
        // Change handler will do a refresh after a timeout when diff is out of date
        if (dv.diffOutOfDate) return false;
        if (!dv.lockScroll) return true;
        var editor, other, now = +new Date;
        if (type == DIFF_INSERT) {
            editor = dv.edit;
            other = dv.orig;
        }
        else {
            editor = dv.orig;
            other = dv.edit;
        }
        // Don't take action if the position of this editor was recently set
        // (to prevent feedback loops)
        if (editor[dir+"state"] && editor[dir+"state"].scrollSetBy == dv && (editor[dir+"state"].scrollSetAt || 0) + 50 > now) return false;

        var sInfo = {
            top: editor.getSession().getScrollTop(),
            left: editor.getSession().getScrollLeft(),
            height: dv.lineHeight*(new Document(editor.getValue()).getLength()),
            clientHeight: $('.ace_scroller',dv.mv.node).height()
        };

        if(dir=="left"){
            if(!other.leftstate){
                other.leftstate = {};
            }
            other.leftstate.scrollSetAt = now;
            other.leftstate.scrollSetBy = dv;
            other.getSession().setScrollLeft(sInfo.left);

            return;
        }

        var halfScreen = .5 * sInfo.clientHeight, midY = sInfo.top + halfScreen;
        var mid = Math.floor(midY/dv.lineHeight);
        var around = chunkBoundariesAround(dv.diff, mid, type == DIFF_INSERT);
        var off = getOffsets(dv.lineHeight,editor, type == DIFF_INSERT ? around.edit : around.orig);
        var offOther = getOffsets(dv.lineHeight,other, type == DIFF_INSERT ? around.orig : around.edit);
        var ratio = (midY - off.top) / (off.bot - off.top);
        var targetPos = (offOther.top - halfScreen) + ratio * (offOther.bot - offOther.top);

        var botDist, mix;
        // Some careful tweaking to make sure no space is left out of view
        // when scrolling to top or bottom.
        if (targetPos > sInfo.top && (mix = sInfo.top / halfScreen) < 1) {
            targetPos = targetPos * mix + sInfo.top * (1 - mix);
        } else if ((botDist = sInfo.height - sInfo.clientHeight - sInfo.top) < halfScreen) {
            var otherInfo = {
                top: other.getSession().getScrollTop(),
                left: other.getSession().getScrollLeft(),
                height: dv.lineHeight*(new Document(other.getValue()).getLength()),
                clientHeight: $('.ace_scroller',dv.mv.node).height()
            }
            var botDistOther = otherInfo.height - otherInfo.clientHeight - targetPos;
            if (botDistOther > botDist && (mix = botDist / halfScreen) < 1)
                targetPos = targetPos * mix + (otherInfo.height - otherInfo.clientHeight - botDist) * (1 - mix);
        }
        if(!other.topstate){
            other.topstate = {};
        }
        other.topstate.scrollSetAt = now;
        other.topstate.scrollSetBy = dv;
        other.getSession().setScrollTop(targetPos);

        return true;
    }

    function getOffsets(lineHeight,editor, around) {
        var bot = around.after;
        if (bot == null) bot = new Document(editor.getValue()).getLength();
        return {top: lineHeight*(around.before || 0),
            bot: lineHeight*bot};
    }

    function setScrollLock(dv, val, action) {
        dv.lockScroll = val;
        if (val && action != false) syncScroll(dv, DIFF_INSERT) && makeConnections(dv);
        dv.lockButton.innerHTML = val ? "\u21db\u21da" : "\u21db&nbsp;&nbsp;\u21da";
    }

    // Updating the marks for editor content

    function clearMarks(editor, arr,gutter) {
        for (var i = 0; i < arr.length; ++i) {
            var mark = arr[i];
            editor.getSession().removeMarker(mark);
        }
        arr.length = 0;
        if(gutter){
            for (var i = 0; i < gutter.length; ++i) {
                editor.getSession().removeGutterDecoration(gutter[i].line,gutter[i].clazz);
            }
            gutter.length = 0;
        }
    }

    function updateMarks(editor, diff, state, type, classes) {
        var from = 0,
            to = new Document(editor.getValue()).getLength(),
            marks = state.marked,
            gutter = state.gutter;

        clearMarks(editor, marks,gutter);

        var session = editor.getSession();
        var pos = Pos(0, 0);
        var top = Pos(from, 0), bot = Pos(to - 1>=0?to - 1:0, session.getLine(to - 1>=0?to - 1:0).length);
        var cls = type == DIFF_DELETE ? classes.del : classes.insert;

        var gutterCls = type == DIFF_DELETE ? "ace-merge-gutter-insert" : "ace-merge-gutter-del";

        //3-way
        function duplClazz(curclass,range){
            var marker = session.getMarkers(),clazz="";
            $.each(marker,function(k,v){
                if(v.range&&v.range.isEqual(range)){
                    if(curclass!=v.clazz&&v.clazz.indexOf('ace-merge-')==0){
                        clazz = v.clazz;
                    }
                }
            });

            if(clazz){
                return  clazz+" "+curclass;
            }
            return curclass;
        }

        function markChunk(start, end) {
            var bfrom = Math.max(from, start), bto = Math.min(to, end),curclass = "",range;
            for (var i = bfrom; i < bto; ++i) {
                range = new Range(i, 0, i,  session.getLine(i).length);
                if (i == start) {
                    if(i==end-1){
                        curclass = classes.startend;
                    }else{
                        curclass = classes.start;
                    }
                }else{
                    if (i == end - 1) {
                        curclass = classes.end;
                    }else{
                        curclass = classes.chunk;
                    }
                }
                curclass = duplClazz(curclass,range);
                var markerID = session.addMarker(range, curclass , "fullLine");
                marks.push(markerID);
                session.addGutterDecoration(i,'ace-merge-gutter-del');
                gutter.push({
                    line: i,
                    clazz:'ace-merge-gutter-del'
                });
            }
            // When the chunk is empty, make sure a horizontal line shows up
            if (start == end && bfrom == end && bto == end) {
                if (bfrom){
                    range = new Range(bfrom - 1,0,bfrom - 1,session.getLine(bfrom - 1).length);
                    curclass = classes.emptyend;
                    session.addGutterDecoration(bfrom - 1,'ace-merge-gutter-del');
                    gutter.push({
                        line: bfrom - 1,
                        clazz:'ace-merge-gutter-del'
                    });
                }else{
                    range = new Range(bfrom,0,bfrom,session.getLine(bfrom).length);
                    curclass = classes.emptystart;
                    session.addGutterDecoration(bfrom,'ace-merge-gutter-del');
                    gutter.push({
                        line: bfrom,
                        clazz:'ace-merge-gutter-del'
                    });
                }

                curclass = duplClazz(curclass,range);
                var markerID = session.addMarker(range, curclass , "fullLine");
                marks.push(markerID);

            }
        }

        var chunkStart = 0;
        for (var i = 0; i < diff.length; ++i) {
            var part = diff[i], tp = part[0], str = part[1];
            if (tp == DIFF_EQUAL) {
                var cleanFrom = pos.line + (startOfLineClean(diff, i) ? 0 : 1);
                moveOver(pos, str);
                var cleanTo = pos.line + (endOfLineClean(diff, i) ? 1 : 0);
                if (cleanTo > cleanFrom) {
                    if (i) markChunk(chunkStart, cleanFrom);
                    chunkStart = cleanTo;
                }
            } else {
                if (tp == type) {
                    var end = moveOver(pos, str, true);
                    var a = posMax(top,pos), b = posMin(bot, end);
                    if (!posEq(a, b)){
                        var range = new Range(a.line,a.ch, b.line,b.ch);
                        var markerID = session.addMarker(range, cls, "text");
                        marks.push(markerID);
                        for(var j=a.line;j<=b.line;j++){
                            session.addGutterDecoration(j,gutterCls);
                            gutter.push({
                                line: j,
                                clazz:gutterCls
                            });
                        }
                    }
                    pos = end;
                }
            }
        }
        if (chunkStart <= pos.line) markChunk(chunkStart, pos.line + 1);
    }

    // Updating the gap between editor and original

    function makeConnections(dv) {
        if (dv.svg) {
            $(dv.svg).html('');
            var w = dv.gap.offsetWidth;
            $(dv.svg).attr({
                width: w,
                height: dv.gap.offsetHeight
            })
        }
        if (dv.copyButtons) $(dv.copyButtons).html('');

        var vpEdit = {
                from: dv.edit.getFirstVisibleRow(),
                to: dv.edit.getLastVisibleRow()
            },
            vpOrig = {
                from: dv.orig.getFirstVisibleRow(),
                to: dv.orig.getLastVisibleRow()
            };
        var sTopEdit = dv.edit.getSession().getScrollTop(),
            sTopOrig = dv.orig.getSession().getScrollTop();
        if($('.ace_scrollbar-v',dv.edit.pane).css('display')=="none"){
            sTopEdit = 0;
        }
        if($('.ace_scrollbar-v',dv.orig.pane).css('display')=="none"){
            sTopOrig = 0;
        }

        iterateChunks(dv.diff, function (topOrig, botOrig, topEdit, botEdit) {
            if (topEdit <= vpEdit.to && botEdit >= vpEdit.from &&
                topOrig <= vpOrig.to && botOrig >= vpOrig.from)
                drawConnectorsForChunk(dv, topOrig, botOrig, topEdit, botEdit, sTopOrig, sTopEdit, w);
        });

    }

    function drawConnectorsForChunk(dv, topOrig, botOrig, topEdit, botEdit, sTopOrig, sTopEdit, w) {
        var lineheight = dv.lineHeight;
        var flip = dv.type == "left";
        var top = lineheight*topOrig - sTopOrig;
        if (dv.svg) {
            var topLpx = top;
            var topRpx = lineheight*topEdit - sTopEdit;
            if (flip) {
                var tmp = topLpx;
                topLpx = topRpx;
                topRpx = tmp;
            }
            var botLpx = lineheight*botOrig - sTopOrig;
            var botRpx = lineheight*botEdit - sTopEdit;
            if (flip) {
                var tmp = botLpx;
                botLpx = botRpx;
                botRpx = tmp;
            }
            var curveTop = " C " + w / 2 + " " + topRpx + " " + w / 2 + " " + topLpx + " " + (w + 2) + " " + topLpx;
            var curveBot = " C " + w / 2 + " " + botLpx + " " + w / 2 + " " + botRpx + " -1 " + botRpx;
            $(dv.svg.appendChild(document.createElementNS(svgNS, "path"))).attr({
                "d": "M -1 " + topRpx + curveTop + " L " + (w + 2) + " " + botLpx + curveBot + " z",
                "class": dv.classes.connect
            })
        }
        if (dv.copyButtons) {
            var copy = dv.copyButtons.appendChild(elt("div", dv.type == "left" ? "\u21dd" : "\u21dc",
                "ace-merge-copy"));
            copy.title = "Revert chunk";
            copy.chunk = {topEdit: topEdit, botEdit: botEdit, topOrig: topOrig, botOrig: botOrig};
            copy.style.top = top + "px";
        }
    }




    function copyChunk(dv, to, from, chunk) {
        if (dv.diffOutOfDate) return;
        to.getSession().replace(new Range(chunk.topEdit, 0,chunk.botEdit, 0),
            from.getSession().getTextRange(new Range(chunk.topOrig, 0,chunk.botOrig, 0)));
    }

    // Merge view, containing 0, 1, or 2 diff views.

    var MergeView = function (node, options) {
        if (!(this instanceof MergeView)) return new MergeView(node, options);

        this.node = node;

        this.options = options;
        var origLeft = options.origLeft, origRight = options.origRight == null ? options.orig : options.origRight;

        var hasLeft = origLeft != null, hasRight = origRight != null;
        var panes = 1 + (hasLeft ? 1 : 0) + (hasRight ? 1 : 0);
        var wrap = [], left = this.left = null, right = this.right = null;

        if (hasLeft) {
            left = this.left = new DiffView(this, "left");
            var leftPane = elt("div", null, "ace-merge-pane");
            wrap.push(leftPane);
            wrap.push(buildGap(left));
        }

        var editPane = elt("div", null, "ace-merge-pane");
        wrap.push(editPane);

        if (hasRight) {
            right = this.right = new DiffView(this, "right");
            wrap.push(buildGap(right));
            var rightPane = elt("div", null, "ace-merge-pane");
            wrap.push(rightPane);
        }

        (hasRight ? rightPane : editPane).className += " ace-merge-pane-rightmost";

        wrap.push(elt("div", null, null, "height: 0; clear: both;"));

        var wrapElt = this.wrap = node.appendChild(elt("div", wrap, "ace-merge ace-merge-" + panes + "pane"));
        this.edit = ace.edit(editPane);
        this.edit.getSession().setMode('ace/mode/'+options.mode);
        this.edit.getSession().setValue(options.value);
        this.edit.setShowFoldWidgets(false);
        this.edit.resize(true);
        this.edit.pane = editPane;

        if (left) left.init(leftPane, origLeft, options);
        if (right) right.init(rightPane, origRight, options);



        var onResize = function () {
            if (left) makeConnections(left);
            if (right) makeConnections(right);
        };
        $(window).bind('resize',function(e){
            onResize(e)
        });

        var resizeInterval = setInterval(function () {
            for (var p = wrapElt.parentNode; p && p != document.body; p = p.parentNode) {
            }
            if (!p) {
                clearInterval(resizeInterval);
                $(window).unbind('resize');
            }
        }, 5000);
    };

    function buildGap(dv) {
        var lock = dv.lockButton = elt("div", null, "ace-merge-scrolllock");
        lock.title = "Toggle locked scrolling";
        var lockWrap = elt("div", [lock], "ace-merge-scrolllock-wrap");
        $(lock).on("click", function () {
            setScrollLock(dv, !dv.lockScroll);
        });

        var gapElts = [lockWrap];

        dv.copyButtons = elt("div", null, "ace-merge-copybuttons-" + dv.type);
        $(dv.copyButtons).on("click", function (e) {
            var node = e.target || e.srcElement;
            if (!node.chunk) return;
            if (node.className == "ace-merge-copy-reverse") {
                copyChunk(dv, dv.orig, dv.edit, node.chunk);
                return;
            }
            copyChunk(dv, dv.edit, dv.orig, node.chunk);
        });
        gapElts.unshift(dv.copyButtons);


        var svg = document.createElementNS && document.createElementNS(svgNS, "svg");
        if (svg && !svg.createSVGRect) svg = null;
        dv.svg = svg;
        if (svg) gapElts.push(svg);


        return dv.gap = elt("div", gapElts, "ace-merge-gap");
    }

    MergeView.prototype = {
        constuctor: MergeView,
        editor: function () {
            return this.edit;
        },
        rightOriginal: function () {
            return this.right && this.right.orig;
        },
        leftOriginal: function () {
            return this.left && this.left.orig;
        },

        rightChunks: function () {
            return this.right && getChunks(this.right);
        },
        leftChunks: function () {
            return this.left && getChunks(this.left);
        }
    };

    function asString(obj) {
        if (typeof obj == "string") return obj;
        else return obj.getValue();
    }

    // Operations on diffs

    var dmp = new diff_match_patch();

    function getDiff(a, b) {
        var diff = dmp.diff_main(a, b);
        dmp.diff_cleanupSemantic(diff);
        // The library sometimes leaves in empty parts, which confuse the algorithm
        for (var i = 0; i < diff.length; ++i) {
            var part = diff[i];
            if (!part[1]) {
                diff.splice(i--, 1);
            } else if (i && diff[i - 1][0] == part[0]) {
                diff.splice(i--, 1);
                diff[i][1] += part[1];
            }
        }
        return diff;
    }

    function iterateChunks(diff, f) {
        var startEdit = 0, startOrig = 0;
        var edit = Pos(0, 0), orig = Pos(0, 0);
        for (var i = 0; i < diff.length; ++i) {
            var part = diff[i], tp = part[0];
            if (tp == DIFF_EQUAL) {
                var startOff = startOfLineClean(diff, i) ? 0 : 1;
                var cleanFromEdit = edit.line + startOff, cleanFromOrig = orig.line + startOff;
                moveOver(edit, part[1], null, orig);
                var endOff = endOfLineClean(diff, i) ? 1 : 0;
                var cleanToEdit = edit.line + endOff, cleanToOrig = orig.line + endOff;
                if (cleanToEdit > cleanFromEdit) {
                    if (i) f(startOrig, cleanFromOrig, startEdit, cleanFromEdit);
                    startEdit = cleanToEdit;
                    startOrig = cleanToOrig;
                }
            } else {
                moveOver(tp == DIFF_INSERT ? edit : orig, part[1]);
            }
        }
        if (startEdit <= edit.line || startOrig <= orig.line)
            f(startOrig, orig.line + 1, startEdit, edit.line + 1);
    }

    function getChunks(dv) {
        ensureDiff(dv);
        var collect = [];
        iterateChunks(dv.diff, function (topOrig, botOrig, topEdit, botEdit) {
            collect.push({origFrom: topOrig, origTo: botOrig,
                editFrom: topEdit, editTo: botEdit});
        });
        return collect;
    }

    function endOfLineClean(diff, i) {
        if (i == diff.length - 1) return true;
        var next = diff[i + 1][1];
        if (next.length == 1 || next.charCodeAt(0) != 10) return false;
        if (i == diff.length - 2) return true;
        next = diff[i + 2][1];
        return next.length > 1 && next.charCodeAt(0) == 10;
    }

    function startOfLineClean(diff, i) {
        if (i == 0) return true;
        var last = diff[i - 1][1];
        if (last.charCodeAt(last.length - 1) != 10) return false;
        if (i == 1) return true;
        last = diff[i - 2][1];
        return last.charCodeAt(last.length - 1) == 10;
    }

    function chunkBoundariesAround(diff, n, nInEdit) {
        var beforeE, afterE, beforeO, afterO;
        iterateChunks(diff, function (fromOrig, toOrig, fromEdit, toEdit) {
            var fromLocal = nInEdit ? fromEdit : fromOrig;
            var toLocal = nInEdit ? toEdit : toOrig;
            if (afterE == null) {
                if (fromLocal > n) {
                    afterE = fromEdit;
                    afterO = fromOrig;
                }
                else if (toLocal > n) {
                    afterE = toEdit;
                    afterO = toOrig;
                }
            }
            if (toLocal <= n) {
                beforeE = toEdit;
                beforeO = toOrig;
            }
            else if (fromLocal <= n) {
                beforeE = fromEdit;
                beforeO = fromOrig;
            }
        });
        return {edit: {before: beforeE, after: afterE}, orig: {before: beforeO, after: afterO}};
    }






    // General utilities

    function elt(tag, content, className, style) {
        var e = document.createElement(tag);
        if (className) e.className = className;
        if (style) e.style.cssText = style;
        if (typeof content == "string") e.appendChild(document.createTextNode(content));
        else if (content) for (var i = 0; i < content.length; ++i) e.appendChild(content[i]);
        return e;
    }


    function moveOver(pos, str, copy, other) {
        var out = copy ? Pos(pos.line, pos.ch) : pos, at = 0;
        for (; ;) {
            var nl = str.indexOf("\n", at);
            if (nl == -1) break;
            ++out.line;
            if (other) ++other.line;
            at = nl + 1;
        }
        out.ch = (at ? 0 : out.ch) + (str.length - at);
        if (other) other.ch = (at ? 0 : other.ch) + (str.length - at);
        return out;
    }

    function posMin(a, b) {
        return (a.line - b.line || a.ch - b.ch) < 0 ? a : b;
    }

    function posMax(a, b) {
        return (a.line - b.line || a.ch - b.ch) > 0 ? a : b;
    }

    function posEq(a, b) {
        return a.line == b.line && a.ch == b.ch;
    }

    window.MergeView = MergeView;
})(this,jQuery);
