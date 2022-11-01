describe("Email Test", () => {
  it("initiate email campaign", () => {
    // have these vars here so it won't affect retry results
    // (e.g. emails received from previous try being counted in the latest one
    // as they share the same subject line)
    const MODE = "email";
    const CSV_FILENAME = "testfile_email.csv";
    const NUM_RECIPIENTS = "1";

    const CUR_DATE = new Date();
    const DATETIME =
      CUR_DATE.getDate() +
      "/" +
      (CUR_DATE.getMonth() + 1) +
      "/" +
      CUR_DATE.getFullYear() +
      "@" +
      CUR_DATE.getHours() +
      ":" +
      CUR_DATE.getMinutes() +
      ":" +
      CUR_DATE.getSeconds();
    const CAMPAIGN_NAME = MODE.concat("_").concat(DATETIME);
    const RANDOM_STRING = "_".concat(
      Math.floor(Math.random() * 1000000 + 1).toString()
    );
    const SUBJECT_NAME = "sub_".concat(DATETIME).concat(RANDOM_STRING);
    const MSG_CONTENT = Cypress.env("MSG_CONTENT").concat(RANDOM_STRING);
    const MSG_TO_VERIFY = Cypress.env("MSG_TO_VERIFY").concat(RANDOM_STRING);

    const OTP_SUBJECT = Cypress.env("OTP_SUBJECT");
    const EMAIL = Cypress.env("EMAIL");
    const MAIL_SENDER = Cypress.env("MAIL_SENDER");
    const WAIT_TIME = Cypress.env("WAIT_TIME");
    const REPORT_WAIT_TIME = Cypress.env("REPORT_WAIT_TIME");

    const EMAIL_TO_EXPECT = 2; //both test and actual emails

    //write csv test file
    const CSV_CONTENT = "recipient,name\n" + EMAIL + ",postman";
    cy.writeFile("cypress/fixtures/".concat(CSV_FILENAME), CSV_CONTENT);

    //log in via OTP
    cy.visit("/login");
    cy.get("input[type=email]");
    cy.get("input[type=email]").type(EMAIL);
    cy.get("button[type=submit]").click();
    cy.wait(WAIT_TIME);

    cy.task("gmail:check", {
      from: MAIL_SENDER,
      to: EMAIL,
      subject: OTP_SUBJECT,
    }).then((email) => {
      assert.isNotNull(email, "OTP email was not found");
      const LOGIN_EMAIL_CONTENT = email[0].body.html;
      const OTP_RE = /\<b\>([^]+)\<\/b\>/;
      const OTP = LOGIN_EMAIL_CONTENT.match(OTP_RE)[1];
      cy.get("input[type=tel]").type(OTP);
      cy.get("button[type=submit]").click();
    });

    //initiate campaign
    cy.contains(":button", "Create").click();
    cy.get('input[id="nameCampaign"]').type(CAMPAIGN_NAME);
    cy.contains(":button", "Email").click();
    cy.contains(":button", "Create").click();

    //step 1 : enter subject and message template
    cy.get('textarea[id="subject"]').type(SUBJECT_NAME);
    cy.get('div[aria-label="rdw-editor"]').type(MSG_CONTENT);
    cy.contains(":button", "Next").click();

    //step 2 : upload csv file
    cy.get('input[type="file"]').attachFile(CSV_FILENAME);
    cy.contains("Message preview");
    cy.contains(CSV_FILENAME);
    cy.contains(NUM_RECIPIENTS.concat(" recipients"));
    cy.contains(":button", "Next").click();

    //step 3 : send test email
    cy.get('input[type="email"]').type(EMAIL);
    cy.get('button[type="submit"]').click();
    cy.contains("validated");
    cy.contains(":button", "Next").click();

    //step 4 : send campaign
    cy.contains(":button", "Send").click();
    cy.contains(":button", "Confirm").click();

    //step 5 : dismiss feedback form
    cy.get('button[title="Close modal"]').click();

    //check stats for success
    cy.contains("Sending completed");
    cy.contains("Sent to recipient").siblings().contains(NUM_RECIPIENTS);
    cy.wait(WAIT_TIME);

    //Verify that email is being received
    cy.task("gmail:check", {
      from: MAIL_SENDER,
      to: EMAIL,
      subject: SUBJECT_NAME,
    }).then((email) => {
      assert(
        email.length == EMAIL_TO_EXPECT,
        "test and/or actual email was not found"
      );
      const MSG_RE = /\<p\>([^]+)\<\/p\>/;
      var msg_cnt = 0;
      for (let i = 0; i < EMAIL_TO_EXPECT; i++) {
        var sent_email_content = email[i].body.html;
        var msg = sent_email_content.match(MSG_RE)[1];
        if (msg != null && msg === MSG_TO_VERIFY) {
          msg_cnt += 1;
        }
        if (i == 0) {
          //actual email
          //load gmail tracking pixel to mark email as read
          const TRACKING_IMG_RE = /\<img alt="" src="([^]+)" /;
          var tracking_img = sent_email_content.match(TRACKING_IMG_RE)[1];
          cy.request(tracking_img);
        }
      }
      assert.equal(
        msg_cnt,
        EMAIL_TO_EXPECT,
        "test and/or actual email has incorrect content"
      );
    });

    //wait for report to be generated and download it
    cy.wait(REPORT_WAIT_TIME);
    cy.contains(":button", "Report").click();

    //check report, status should be READ
    cy.wait(WAIT_TIME);
    const downloadPath = Cypress.config("downloadsFolder");
    cy.task("findDownloaded", downloadPath).then((file_names) => {
      file_names.forEach((name) => {
        if (name.startsWith(MODE)) {
          cy.readFile(downloadPath + "/" + name).should("contain", "READ");
        }
      });
    });
  });
});
