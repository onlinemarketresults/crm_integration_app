//= require ./app.js

(function() {

  ZendeskApps.CRMIntegrationApp = ZendeskApps.App.extend({
    location: ZendeskApps.Site.TICKET_PROPERTIES,
    appID: '/apps/01-crm-integration/versions/1.0.0',
    name: 'CRM Integration',

    // Local vars
    currentDelay: 5000,
    currentTimeoutID: undefined,
    timesRequested: 0,
    INITIAL_DELAY: 5000,
    MAX_SYNC_RETRIES: 5,

    defaultSheet: 'loading',

    dependencies: {
      requesterID:  'Zendesk.currentTicket.requester.id'
    },

    templates: {
      main: '<div class="crm_integration_app">' +
            '  <div>' +
            '    <h3>CRM Integration <span class="loader" style="display: none;">&nbsp;&nbsp;<img src="/console/assets/ajax-loader-1.gif"/></span></h3>' +
            '  </div><hr/>' +
            '  <section data-sheet-name="records" class="records"></section>' +
            '  <section data-sheet-name="loading" class="loading"></section>' +
            '  <section data-sheet-name="message" class="message"></section>' +
            '  <section class="append_error"></section>' +
            '</div>',
      recordsData:  '{{#mainRecord}}' +
                    '  <p class="type"><a href="{{url}}" target="_blank">{{label}}{{#if record_type}} ({{record_type}}) {{/if}}</a></p>' +
                    '  <ul>{{#fields}}<li class="field"><p><span class="field_label">{{label}} </span></p><p>{{value}}</p></li>{{/fields}}</ul>' +
                    '{{/mainRecord}}' +
                    '{{^mainRecord}}<p>{{I18n.records.no_data}}.</p>{{/mainRecord}}' +
                    '<div class="sub_records" style="display:none;">' +
                    '  {{#subRecords}}' +
                    '    <p class="type"><a href="{{url}}" target="_blank">{{label}}{{#if record_type}} ({{record_type}}) {{/if}}</a></p>' +
                    '    <ul>{{#fields}}<li class="field"><p><span class="field_label">{{label}} </span></p><p>{{value}}</p></li>{{/fields}}</ul>' +
                    '  {{/subRecords}}' +
                    '</div>' +
                    '{{#if showMore}}' +
                    '  <p class="show_more">' +
                    '    <a href="#" class="records_toggle" onclick="return false;">{{I18n.records.show_all}} ({{showMore}})</a>' +
                    '    <a href="#" class="records_toggle" onclick="return false;" style="display: none;">{{I18n.records.minimize}}</a>' +
                    '  </p>' +
                    '{{/if}}',
      error:  '<div class="error">{{message}}</div>',
      info:  '<div class="info">{{message}}</div>'
    },

    translations: {
      problem: "There's been a problem: {{error}}",

      records: {
        minimize: "Minimize results",
        no_data:  "No data found",
        show_all: "Show all results"
      },

      sync: {
        error:    "Failed to synchronize user info.",
        pending:  "Syncing user info..."
      }
    },

    requests: {
      lookupByID:   function(userID) { return { url: encodeURI("/api/v2/crm/%@.json".fmt(userID)) }; },
      syncUserInfo: function(userID) { return { url: encodeURI("/api/v2/crm/%@/sync_user_info.json".fmt(userID)) }; }
    },

    events: {
      'click .records .records_toggle': 'toggleShowMore',

      /** App callbacks **/
      'requesterID.changed': 'firstLookup',

      /** Ajax callbacks **/
      'lookupByID.success':   'handleLookupResult',
      'syncUserInfo.success': 'handleSyncUserInfoResult',

      'lookupByID.fail':                'handleFailedRequest',
      'handleSyncUserInfoResult.fail':  'handleFailedRequest'
    },

    firstLookup: function() {
      // Remove this code when apps start resetting state with route changes (keep clearTimeout)
      this._resetAppState();

      if (this.deps.requesterID)
        this.request('lookupByID').perform(this.deps.requesterID);
    },

    handleLookupResult: function(e, data, textStatus, response) {
      var records = data.records || [];

      if (response.status === 202) { // syncing user with CRM
        this._scheduleCheck();

        if (records.length === 0) {
          this.showMessage(this.I18n.t('sync.pending'));
          return;
        }
      }

      this._renderRecords(records);
    },

    handleSyncUserInfoResult: function(e, data, textStatus, response) {
      var records = data.records || [];

      //remove spinning
      this.$('.loader').hide();

      // Returned 303 and location header, which redirects to show and returns request result
      // If response is slow, GET show can return 202 (just show the data and avoid entering a loop)
      if ( (response.status === 200 && data.state === undefined) || response.status === 202 ) {
        this._renderRecords(records);
        return;
      }

      switch(data.state) {
        case "pending":
          this._scheduleCheck();
          break;
        case "done": // Should not execute this codepath, just to be safe
          this._renderRecords(records);
          break;
        case "failed":
          this.appendError(this.I18n.t('sync.error'));
          break;
        default:
          this.appendError(this.I18n.t('sync.error'));
      }
    },

    _renderRecords: function(records) {
      this.sheet('records')
        .render('recordsData', { mainRecord: records[0], showMore: records.slice(1).length, subRecords: records.slice(1) })
        .show();
    },

    _resetAppState: function() {
      this.sheet('loading').show();
      this.currentDelay = this.INITIAL_DELAY;
      this.timesRequested = 0;
      this.$('.loader').hide();
      this.$('.append_error').html('');
      clearTimeout(this.currentTimeoutID);
    },

    _scheduleCheck: function() {
      var self = this;
      this.timesRequested++;

      if (this.timesRequested > this.MAX_SYNC_RETRIES) {
        this.appendError(this.I18n.t('sync.error'));
        return;
      }

      // show spinning
      this.$('.loader').show();

      this.currentTimeoutID = setTimeout(function() {
        self.request('syncUserInfo').perform(self.deps.requesterID);
      }, this.currentDelay);

      this.currentDelay *= 2;
    },

    toggleShowMore: function() {
      var self = this;

      this.$(".records .sub_records").slideToggle(function() {
        self.$(".records_toggle").toggle();
      });
    },

    /** Helpers **/
    appendError: function(msg) {
      this.$('.append_error').html(msg);
    },

    handleFailedRequest: function(event, jqXHR, textStatus, errorThrown) { this.showError( this.I18n.t('problem', { error: errorThrown.toString() }) ); },

    showError: function(msg) {
      this.sheet('message')
        .render('error', { message: msg })
        .show();
    },

    showMessage: function(msg) {
      this.sheet('message')
        .render('info', { message: msg })
        .show();
    }
  });

}());
