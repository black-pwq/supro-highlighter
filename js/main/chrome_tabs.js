class ChromeTabs {
  /**
   * Creates an instance of Tabs
   * 
   * @param {number} tabId - id of tab that all instance methods target 
   * @memberof ChromeTabs
   */
  constructor(tabId) {
    this.tabId = tabId
  }

  /**
   * @typedef {Object} Tab
   * @prop {number} id - tab id
   * @prop {string} url - tab url
   */

  /**
   * @typedef {Object} QueryInfo
   * @prop {boolean} [active] - Whether the tabs are active in their windows.
   * @prop {string|string[]} [url] - Match tabs against one or more URL patterns. Note that fragment identifiers are not matched.
   * @prop {string} [status] - Whether the tabs have completed loading. ('loading' or 'complete')
   * @prop {boolean} [currentWindow] - Whether the tabs are in the current window.
   */
  
   /**
   * Gets all tabs that have the specified properties, or all tabs if no properties are specified.
   * 
   * @static
   * @param {QueryInfo} [info] - chrome.tabs query info object
   * @returns {Promise<Tab[]>} array of tabs
   * @memberof ChromeTabs
   */
  static query(info) {
    return new Promise(resolve => {
      chrome.tabs.query(info, tabs => resolve(tabs))
    })
  }

  /**
   * Get the tab that is active in the current window
   * 
   * @static
   * @returns {Promise<Tab>} tab, or null
   * @memberof ChromeTabs
   */
  static queryActiveTab() {
    return ChromeTabs.query({
      active: true,
      currentWindow: true 
    }).then(tabs => {
      return tabs.length > 0 ? tabs[0] : null
    })
  }

  //

  /**
   * Retrieves details about the specified tab
   * 
   * @returns {Promise<Tab>} tab, or null
   * @memberof ChromeTabs
   */
  get() {
    return new Promise(resolve => {
      chrome.tabs.get(this.tabId, tab => resolve(tab))
    })
  }

  //

  /**
   * @typedef {Object} ExecuteScriptDetails
   * @prop {boolean} [allFrames=false] - If true implies that the JavaScript or CSS should be injected into all frames of current page
   */

  /**
   * Injects JavaScript code into a page.
   * 
   * @param {string|string[]} files - JavaScript or CSS file to inject. If array, files are injected sequentially
   * @param {ExecuteScriptDetails} [details] - injection details
   * @returns {Promise}
   * @memberof ChromeTabs
   */
  executeScript(files, details = {}) {
    if (Array.isArray(files)) {
      // map to array of promise-returning functions
      const pfuncs = files.map(f => {
        return () => this.executeScript(f, details)
      })

      // execute each script in series
      return PromiseUtils.serial(pfuncs)
    }

    return new Promise((resolve, reject) => {
      chrome.tabs.executeScript(
        this.tabId,
        Object.assign({file: files}, details), 
        result => { 
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
            return
          }

          resolve(result)
        }
      )
    })
  }

  /**
   * Execute the standard set of scripts on the tab's content page
   * 
   * @param {ExecuteScriptDetails} [details={}] - injection details
   * @returns 
   * @memberof ChromeTabs
   */
  executeDefaultScript(details = {}) {
    return this.executeScript(ChromeTabs.DEFAULT_SCRIPTS, details)
  }

  //

  /**
   * TODO
   * @typedef {Object} Message
   * @prop {string} id - predefined type of message
   */

  /**
   * Send a message synchronously to a tab
   * Executes default scripts if response implies there was no handler
   * 
   * @param {Object} message - message sent to tab content script
   * @param {Object} [options] [{ executeDefaultScript = false }={}] 
   * @returns {Promise<*>} message response
   * @memberof ChromeTabs
   */
  sendMessage(message, { executeDefaultScript = false } = {}) {
    return (executeDefaultScript ? this.executeDefaultScript() : Promise.resolve()).then(() => {
      return this.sendMessageInternal(message)
    }).catch(e => {
      if (!executeDefaultScript) {
        return this.sendMessage(message, { executeDefaultScript: true })
      }
      
      throw (e)
    })
  }
  
  /**
   * Companion method for `sendMessage()`
   * 
   * @private
   * @param {Object} message - object of any shape
   * @returns {Promise<*>} resolves if no last error defined and the result is defined (handled)
   * @memberof ChromeTabs
   */
  sendMessageInternal(message) {
    return new Promise((resolve, reject) => {
      // send message to page
      chrome.tabs.sendMessage(this.tabId, message, response => {
        // explicit error
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }

        // all messages must send back a defined result (even if null)
        if (typeof response !== 'undefined') {
          resolve(response)
          return
        }

        // not handling message is a rejection case
        reject(new Error("Undefined response"))
      })
    })
  }

  //

  /**
   * @typedef {Object} XRange 
   * @prop {boolean} [collapsed]
   * @prop {string} startContainerPath - xPath for node within which the Range starts.
   * @prop {number} startOffset - number representing where in the startContainer the Range starts.
   * @prop {string} endContainerPath - xPath for node within which the Range end.
   * @prop {number} endOffset - number representing where in the endContainer the Range ends.
   */

  /**
   * Create a highlight in the DOM
   * 
   * @param {XRange} range - range object with xPath selection range
   * @param {string} className - name of class defining style of highlight
   * @param {string} highlightId - unique id for highlight, usually same as 'create' document's Id
   * @returns {Promise<boolean>} true if highlight span could be created 
   * @memberof ChromeTabs
   */
  createHighlight(range, className, highlightId) {
    return this.sendMessage({
      id: ChromeTabs.MESSAGE_ID.CREATE_HIGHLIGHT,
      range: range,
      highlightId: highlightId,
      className: className
    })
  }

  /**
   * Update a highlight's className in the DOM
   * 
   * @param {string} highlightId - unique id for highlight, usually same as 'create' document's Id
   * @param {string} className - name of class defining style of highlight
   * @returns {Promise<boolean>} true if update succeeded
   * @memberof ChromeTabs
   */
  updateHighlight(highlightId, className) {
    return this.sendMessage({
      id: ChromeTabs.MESSAGE_ID.UPDATE_HIGHLIGHT,
      highlightId: highlightId,
      className: className
    })
  }

  /**
   * Delete highlight in DOM
   * 
   * @param {string} highlightId - unique id for highlight, usually same as 'create' document's Id
   * @returns {Promise<boolean>} true if delete succeeded
   * @memberof ChromeTabs
   */
  deleteHighlight(highlightId) {
    return this.sendMessage({
      id: ChromeTabs.MESSAGE_ID.DELETE_HIGHLIGHT,
      highlightId: highlightId,
    })
  }

  //

  /**
   * Get a range object representing the current selection of the content's document
   * 
   * @returns {Promise<XRange>} - XRange object (even if no selection)
   * @memberof ChromeTabs
   */
  getSelectionRange() {
    return this.sendMessage({
      id: ChromeTabs.MESSAGE_ID.GET_SELECTION_RANGE
    })
  }

  /**
   * Get the text of a range in the content's document
   * 
   * @param {XRange} xrange - range to query
   * @returns {Promise<string|Null>} text of selection, or null if not found
   * @memberof ChromeTabs
   */
  getRangeText(xrange) {
    return this.sendMessage({
      id: ChromeTabs.MESSAGE_ID.GET_RANGE_TEXT,
      xrange: xrange,
    })
  }

  /**
   * Select the text of a highlight in the content's document
   * 
   * @param {string} [highlightId] - #id of highlight in DOM. If undefined, clear document's selection
   * @returns {Promise<XRange|Null>} xrange of selected highlight, or null if no highlight was supplied
   * @memberof ChromeTabs
   */
  selectHighlight(highlightId) {
    const message = { id: ChromeTabs.MESSAGE_ID.SELECT_HIGHLIGHT }

    if (highlightId) {
      message.highlightId = highlightId
    }

    return this.sendMessage(message)
  }

  /**
   * Select a range of text in the document
   * 
   * @param {XRange} [xrange] - range to select. clear selection if undefined
   * @returns {Promise<XRange|Null>} xrange of selected highlight, or null if no highlight was supplied
   * @memberof ChromeTabs
   */
  selectRange(xrange) {
    const message = { id: ChromeTabs.MESSAGE_ID.SELECT_RANGE }
    if (xrange) {
      message.xrange = xrange
    }
    
    return this.sendMessage(message)
  }

  /**
   * Query DOM whether a highlight exists
   * 
   * @param {string} highlightId - #id of highlight (aka 'create' doc _id)
   * @returns {Promise<boolean>} true if in DOM, else false
   * @memberof ChromeTabs
   */
  isHighlightInDOM(highlightId) {
    return this.sendMessage({
      id: ChromeTabs.MESSAGE_ID.IS_HIGHLIGHT_IN_DOM,
      highlightId: highlightId,
    })
  }

  /**
   * Scroll document to a highlight
   * 
   * @param {string} highlightId - #id of highlight (aka 'create' doc _id)
   * @returns {Promise<boolean>} true if element found, else false
   * @memberof ChromeTabs
   */
  scrollToHighlight(highlightId) {
    return this.sendMessage({
        id: ChromeTabs.MESSAGE_ID.SCROLL_TO,
        fragment: highlightId
    });
  }

  /**
   * Get a value of an attribute in the document's DOM
   * 
   * @param {string} xpathExpression - xPath for element to evaluate
   * @param {string} attributeName - name of attribute
   * @returns {Promise<string|Null>} value of attribute, or null if no element/attribute
   * @memberof ChromeTabs
   */
  getNodeAttributeValue(xpathExpression, attributeName) {
    return this.sendMessage({
      id: ChromeTabs.MESSAGE_ID.GET_NODE_ATTRIBUTE_VALUE,
      xpathExpression: xpathExpression,
      attributeName: attributeName,
    })
  }


  /**
   * @typedef {Object} BoundingClientRect
   * @prop {number} top 
   * @prop {number} right 
   * @prop {number} bottom 
   * @prop {number} left 
   * @prop {number} width 
   * @prop {number} height 
   */

  /**
   * Get the bounding client rect of a highlight in the document
   * 
   * @param {string} highlightId - #id of highlight (aka 'create' doc _id)
   * @returns {Promise<BoundingClientRect|Null>}
   * @memberof ChromeTabs
   */
  getHighlightBoundingClientRect(highlightId) {
    return this.sendMessage({
      id: ChromeTabs.MESSAGE_ID.GET_BOUNDING_CLIENT_RECT,
      highlightId: highlightId,
    })
  }

  /**
   * Get the #id of the highlight that is currently being hovered over
   * 
   * @returns {Promise<String|Null>} id or null
   * @memberof ChromeTabs
   */
  getHoveredHighlightID() {
    return this.sendMessage({
      id: ChromeTabs.MESSAGE_ID.GET_HOVERED_HIGHLIGHT_ID
    })
  }

  // /** 
  //  * @typedef {Object} Document
  //  * @prop {string} verb - create or delete 

  //  * @prop {string} _id - id of document
  //  * @prop {string} _rev - revision of document
  //  * 
  //  * @prop {string} match - string formed by processing the associated page's url
  //  * @prop {number} date - date of document put/post, as ns since 1970
  //  * @prop {Object} [range] - creation document range with xPath 
  //  * @prop {string} [className] - className identifying style of create highlight. Used in DOM
  //  * @prop {string} [text] - text within create highlight
  //  * @prop {string} [title] - title of page highlight was created from
  //  * @prop {string} [correspondingDocumentId] - id of 'create' doc associated with this `delete` doc
  //  */

  /**
   * 
   * 
   * @param {Object[]} documents - array of documents to play back serially 
   * @param {Function} [onPlaybackError] - method called after each document that doesn't play back successfully
   * @returns {Promise<number>} sum of create/delete documents, where create is +1, delete is -1. If zero, no highlights. Rejects if any create/delete method rejects.
   * @memberof ChromeTabs
   */
  playbackDocuments(documents, onPlaybackError) {
    let sum = 0

    // map to array of functions that return a promise
    return PromiseUtils.serial(documents.map(doc => {
      return () => {
        // main promise
        const promise = (() => {
          switch (doc[DB.DOCUMENT.NAME.VERB]) {
            case DB.DOCUMENT.VERB.CREATE:
              sum++
    
              // each highlight's unique id (#id) is the document's _id
              return this.createHighlight(
                doc[DB.DOCUMENT.NAME.RANGE],
                doc[DB.DOCUMENT.NAME.CLASS_NAME],
                doc._id
              )

            case DB.DOCUMENT.VERB.DELETE:
              sum--

              return this.deleteHighlight(doc[DB.DOCUMENT.NAME.CORRESPONDING_DOC_ID])

            default:
              console.error('unknown verb')
              return Promise.resolve(false)
          }
        })()

        // wrapper (note that thrown errors are unhandled)
        return promise.then(ok => {
          if (!ok && onPlaybackError) {
            onPlaybackError(doc)
          }
        })
      }
    })).then(() => sum)
  }

  /**
	 * Get a sort comparison function, which takes a document and returns a promise that resolves to a comparable value
   * 
	 * @param {string} sortby - type of sort
	 * @return {Function<Promise>} Function that returns a promise that gets a comparable value
	 */
	getComparisonFunction(sortby) {
		switch(sortby) {
        case "time":
            // simply order by creation time (which it probably already does)
            return doc => Promise.resolve(doc.date)
			
        case "location":
            return doc => {
                // resolve to top of bounding client rect
                return this.isHighlightInDOM(doc._id).then(isInDOM => {
                    return isInDOM ?
                      this.getHighlightBoundingClientRect(doc._id) :
                      Promise.reject(new Error())
                }).then(rect => rect.top)
            }

        case "style":
            // items are ordered by the index of its associated style. Build a map for faster lookup
            let map = new Map()

            return doc => {
                if (map.size === 0) {
                    return new ChromeHighlightStorage().getAll().then(items => {
                        // key is definition className, value is the index that occupies
                        items[ChromeHighlightStorage.KEYS.HIGHLIGHT_DEFINITIONS].forEach(({className}, index) => {
                            map.set(className, index)
                        })
                    }).then(() => map.get(doc.className))
                }

                return Promise.resolve(map.get(doc.className))
            }

		default:
			throw "Unknown type";
		}
  }
  
  /**
   * Get an overview of the tab's highlights as formatted text 
   * 
	 * @param {string} format one of [markdown]
	 * @param {Function} [comparator] function that returns a promise that resolves to a comparible value
   * @param {Boolean} [invert] invert the document order
	 * @returns {Promise<string>} overview correctly formatted as a string
   * @memberof ChromeTabs
   */
  getFormattedOverviewText(format, comparator,/* filterPredicate,*/ invert) {
    let tab
    const titles = new Map()

    return this.get().then(t => {
      tab = t

      return new ChromeHighlightStorage().getAll()
        .then(items => items[ChromeHighlightStorage.KEYS.HIGHLIGHT_DEFINITIONS])
    }).then(definitions => {
      // map the highlight class name to its display name, for later usage
      for (const d of definitions) {
          titles.set(d.className, d.title)
      }

      // get documents associated with the tab's url
      // get only the create docs that don't have matched delete doc
      return new DB().getMatchingDocuments(DB.formatMatch(tab.url), { excludeDeletedDocs: true })
    }).then(docs => {
      // filter
      // if (filterPredicate) {
      //   docs = docs.filter(filterPredicate)
      // }
      
      // sort - main promise (default to native order)
      return (comparator && DB.sortDocuments(docs, comparator)) || Promise.resolve(docs)
    }).then(docs => {
      if (invert) {
        docs.reverse()
      }

      switch (format) {
        case ChromeTabs.OVERVIEW_FORMAT.MARKDOWN:
        case ChromeTabs.OVERVIEW_FORMAT.MARKDOWN_NO_FOOTER:
            let markdown = `# [${tab.title}](${tab.url})`
            let currentClassName

            // iterate each highlight
            for (const {className, text} of docs) {
                // only add a new heading when the class of the header changes
                if (className != currentClassName) {
                    markdown += `\n\n## ${titles.get(className)}`

                    currentClassName = className
                } else {
                    // only seperate subsequent list items
                    markdown += "\n"
                }

                // each highlight is an unordered list item
                markdown += `\n* ${text}`
            }

            // footer
            if (format !== ChromeTabs.OVERVIEW_FORMAT.MARKDOWN_NO_FOOTER) {
                markdown += `\n\n---\n${chrome.i18n.getMessage("overview_footer", [
                  chrome.i18n.getMessage("extension_name"),
                  chrome.i18n.getMessage("extension_webstore_url"),
                  chrome.i18n.getMessage("copyright_year"),
                  chrome.i18n.getMessage("extension_author"),
                  chrome.i18n.getMessage("extension_author_url")
              ])}`
            }

            return Promise.resolve(markdown)

        default:
            return Promise.reject(new Error('unknown format'))
      }
    })
  }
}

// static properties

ChromeTabs.OVERVIEW_FORMAT = {
  MARKDOWN: 'markdown',
  MARKDOWN_NO_FOOTER: 'markdown-no-footer',
}

ChromeTabs.DEFAULT_SCRIPTS = [
  "js/main/chrome_storage.js", "js/main/chrome_highlight_storage.js",
  
  "js/utils.js",
  "js/stylesheet.js",
  "js/content_script/range_utils.js",
  "js/content_script/highlighter.js",
  "js/content_script/content_script.js"
]

ChromeTabs.MESSAGE_ID = {
  CREATE_HIGHLIGHT: 'create_highlight',
  UPDATE_HIGHLIGHT: 'update_highlight',
  DELETE_HIGHLIGHT: 'delete_highlight',
  GET_SELECTION_RANGE: 'get_selection_range',
  GET_RANGE_TEXT: 'get_range_text',
  SELECT_HIGHLIGHT: 'select_highlight',
  SELECT_RANGE: 'select_range',
  IS_HIGHLIGHT_IN_DOM: 'is_highlight_in_dom',
  SCROLL_TO: 'scroll_to',
  GET_NODE_ATTRIBUTE_VALUE: 'get_node_attribute_value',
  GET_BOUNDING_CLIENT_RECT: 'get_bounding_client_rect',
  GET_HOVERED_HIGHLIGHT_ID: 'get_hovered_highlight_id'
}