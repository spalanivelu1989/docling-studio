**Functional Specification Document**

**SPARK P2P**

**GAP ID 21517 - LIMS Integration - Inspection Lot SAP to LIMS - Outbound**

<!-- no readable text in image1.png (OCR confidence 0.0) -->

| **GAP/ WRICEF ID**        | 21517                                                                                                                                                                                                                                                                           |
|---------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **GAP Title**             | LIMS Integration Inspection Lot SAP to LIMS                                                                                                                                                                                                                                     |
| **Stream / Process Area** | ☐ Hire to Retire               ☐ Acquire to Dispose    ☐ Lead to Cash  ☐ Forecast to Stock       ☐ Source to Pay             ☒ Plan to Produce  ☐ Inventory to Deliver    ☐ Record to Report        ☐ EHS  ☐ Sustainability               ☐ Global Trade Services    ☐ Security |
| **Sub Process Area**      | *Specify the Sub Process Area. For ex: Accounts payable subprocess if process area is finance.*                                                                                                                                                                                 |
| **Complexity**            | ☒ Simple                                                ☐ Medium  ☐ Complex                                             ☐  High Complex                                                                                                                                         |
| **Global/ Local**         | Global                                                  Local                                                                                                                                                                                                                   |
| **GAP JIRA Link**         | https://solvayagile.atlassian.net/browse/SPARK-21517                                                                                                                                                                                                                            |

**Table of Contents**

**1	Document Control Information	4**

1.1	Document Edit History	4

1.2	References	4

1.3	Acronyms and Definitions	4

**2	Summary	5**

2.1	Functional description	5

2.2	Business Driver	5

2.3	Impacted Systems	5

**3	Business Process Considerations	6**

3.1	Process Description and Flow	6

3.2	Trigger	6

3.3	Processing Options &amp; Volume	6

3.4	Dependencies	7

3.4.1	Configuration Dependencies	7

3.4.2	Development Dependencies	7

**4	Functional Design Considerations	8**

4.1	Interface Details	8

4.1.1	Mapping and Transformation	8

4.1.2	Proposed Message Type /API	8

4.1.3	4.1.3 Routing Rules	8

4.1.4	Reprocessing	8

**5	Security and Controls	9**

5.1	Security Requirements	9

5.2	Monitoring and alert control	11

5.3	Data Encryption / Decryption Requirements	11

**6	Functional Unit Test Scenarios	12**

**7	Attachments and Documentation	13**

## 1 Document Control Information

### Document Edit History

| Version   | Date       | Status   | Author(s)       | Author(s), Reviewed by (roles/names)   | Approved by (role/name)   | Change Summary   | Approved by (role/name)   |
|-----------|------------|----------|-----------------|----------------------------------------|---------------------------|------------------|---------------------------|
| *V-1*     | 09/02/2026 | Draft    | Gopi Boinipelly |                                        |                           |                  |                           |
| *V-2*     |            |          |                 |                                        |                           |                  |                           |

### Document Review and Sign Off

| Version   | Role   | Name   | Responsibility (Reviewer/Approver)   | Signature and Date   | Comments / Conditions   |
|-----------|--------|--------|--------------------------------------|----------------------|-------------------------|
|           |        |        |                                      |                      |                         |
|           |        |        |                                      |                      |                         |

### References

*Add details on all the other documents/objects that are related to this object ID*

| Document ID   | Description   | Version   |
|---------------|---------------|-----------|
|               |               |           |
|               |               |           |

### Acronyms and Definitions

*Add acronyms and definitions used in the document to this section*

| Acronym/Term   | Description   |
|----------------|---------------|
|                |               |
|                |               |

## 2 Summary

*The purpose of this interface is to send the Quality Inspection lot data to be sent out to LIMS System automatically on creation of Inspection lot in SAP for the Material Which require Quality inspection, The LIMS System will perform the results Entry and the usage decision in LIMS and send the results back to SAP. LIMS Will be the Front-end System for the Quality Lab Application purpose.*

### 2.1 Functional description

*The Inspection lot data needs to be sent out to LIMS System automatically on creation of Inspection lot in SAP for the Material Which require Quality inspection, The LIMS System will perform the results Entry and the usage decision in LIMS and send the results back to SAP. LIMS Will be the Front-end System for the Quality Lab Application purpose and SAP will be the backend system for the Generation of the COA.*

*In case the inspection lot is cancelled, then the cancellation information should be sent to the External LIMS, so that the inspection processing / results recording does not begin in SAP.*

<!-- tables in image2.png read by image processing + tesseract -->

Quaity Engneer

Qualty

Qualtty Manager

Sample Authoriza- tion QC Decision

Decide if it & one or two step approval

1 step approval

Send UD to SAP

| inspection Lot Crested and Re- leased |  |
|---|---|
|  | Send Irepection Lot 20 UMS |
| inspection Lot re- ceived |  |
|  | UMS Sompie is Pro- cossad |
| Equipment integra- tien |  |
|  | UMS Resuts Recordng |
|  | Send Resuks Record:ng to SAP |
|  | Results Recordings Received |
|  | Send status update (validaton) to SAP |
|  | L |
|  | Status Update Re- coved |

<!-- OCR of image3.png via tesseract, mean confidence 83.8 -->

Execute second Ap. provwal in SAP

Usage Decision Made

### 2.2 Business Driver

This interface will serve as the starting point for sending the Inspection Lot details so that they can be used in LIMS to send back the results for the characteristics and usage decision back to SAP

The above process will help streamline the process of product disposition to decide if a product is accepted or rejected and link the product with the stock disposition and integrate upstream and downstream the business processes in SAP

### 2.3 Impacted Systems

*In the list below, check all systems that will either be sending or receiving data as part of this interface.  The list of possible systems for this project should have been developed as part of the first functional specification template.  Please include both the middleware application and other systems that will be receiving the data.*

*Perform Results recording and Usage decision process will be impacted if the inspection lot details are not sent to LIMS for inspection processing.*

| Jira ID     | Gap description                                                          |
|-------------|--------------------------------------------------------------------------|
| SPARK-21518 | 7.4.8.5 LIMS Integration - GAP - Results Recording LIMS to SAP - Inbound |
| SPARK-21519 | 7.4.8.5 LIMS Integration - GAP - Usage Decision LIMS to SAP              |

| **Source System**   | **GBU**                                              |
|---------------------|------------------------------------------------------|
| PF1 = ERP           | Spec Chem, Peroxides, Soda Ash & Derivatives, Silica |
| WP1 = ERP           | N/A for first go-live                                |
| S/4 HANA            | Target new System                                    |
| LIMS                | Labware                                              |

## 3 Business Process Considerations

*The following sections outline the requirements for the GAP object. The requirements, business rules and design specifications are combined in this document to provide a comprehensive view of the functional design* .

### 3.1 Process Description and Flow

*The inspection lot once it is created in SAP will be sent to LIMS on a real time basis. The inspection processing will happen in LIMS and the results data is sent back to SAP along with the usage decision data.*

*As soon as an inspection lot is created an inspection lot business event is triggered, and the Event Mesh is notified with meta data for the inspection lot. The CPI is notified via a Webhook Connection from the Event Mesh. After receiving the information from Event Mesh. CPI will get the data for the inspection lot via the Get API. CPI will perform the further transformation of the message if required and then perform the Web Service call to post the data to LIMS.*

<!-- OCR of image4.png via tesseract, mean confidence 88.1 -->

Event

dleware hh

Mesh

InspLot (WC:LIMS*)

Metadata from SAP

InspLot (WC:LIMS*)

Event Notification

CPI

Post data to LIMS

Event Monitoring & Reprocessing with Inshights

InspLot (WC:LIMS*)

Event Monitoring & Processing

### 3.2 Trigger

*Specify the trigger for the Interface. If it is SAP transactions, please provide the transaction flow details which triggers interface.*

*Creation of inspection lot (automatically or manually) created event will be triggered; the event mesh has filter condition which plant and work center. CPI will receive the notification based on this CPI should read the inspection lot information from SAP using API and send the information to external LIMS.*

### 3.3 Processing Options &amp; Volume

*Indicate the processing mode, processing type and frequency of development from below options:*

**Processing Mode**

☐ *Batch		☐ **Real Time 		☒ ***Near Real Time

**Processing Type**

☐ Synchronous 	☒ Asynchronous

**Frequency**

☐ Annually			☐ Quarterly 			☐ Monthly

☐ Weekly			☐ Daily			☒ On Demand

☐ Other (If other, describe here) \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

**Interface Type**

☐ Point to Point 	☒ via Middleware (CPI)

**Volume**

Average Demand		: Approx. 8000 Packages per month

Peak Demand			: Approx. 10000 Packages per month

***Near Real Time refers to a system integration approach where data is exchanged between systems with minimal delay—typically seconds or minutes, but not instantaneously.

### 3.4 Dependencies

*Specify any Configuration, development, and execution dependencies for this development in the subsections below.*

#### 3.4.1 Configuration Dependencies

***List the configuration work that must be considered during the development of this object and that needs to be in place before this requirement can be tested. This section should answer the question “What are the configurations needed for this object?”***

| **List of dependent configurations**   | **Describe the dependency**   | **Owner/Team Responsible of dependent task**   | **Comments**   |
|----------------------------------------|-------------------------------|------------------------------------------------|----------------|
|                                        |                               |                                                |                |
|                                        |                               |                                                |                |

#### 3.4.2 Development Dependencies

***List the development, and other work that must be considered during the development of this development object. This section should answer the question “What other WRICEF object this development depends on?”***

| **GAP ID**   | **Description**   | **WRICEF ID**   | **Describe the dependency**   | **Comments**   |
|--------------|-------------------|-----------------|-------------------------------|----------------|
|              |                   |                 |                               |                |
|              |                   |                 |                               |                |

## 4 Functional Design Considerations

*Provide details about the interface itself. This section should explain what the exact details of the interface approval/rejection details, etc.*

**Relevant API: API\_INSPECTIONLOT\_SRV**

Business Transaction Events for Inspection Lot

**Create:**

- **Object Category** : BOR (Business Object Repository)
- **Object Type** : BUS2045 (Inspection Lot)
- **Event** : CREATED

**Change:**

- **Object Category** : BOR (Business Object Repository)
- **Object Type** : BUS2045 (Inspection Lot)
- **Event** : CHANGED

***Design:***

1. *After creation or change of an inspection lot, Event Mesh notification will be triggered to CPI based on filter criteria (Plant and Work Center and*
2. *To fetch custom fields Source Batch and Inspection Lot, additional logic is required as provided in the mapping file.*
3. *After sending the notification to CPI, the user status in the inspection lot should be updated.*
4. *CPI will connect to S/4 using the standard API\_INSPECTIONLOT\_SRV and will utilize multiple entities as mentioned in the mapping file to get inspection lot details.*
5. *Any conversion or transformation of data field values for the respective 3rd party system will be applied at CPI.*
6. *Once CPI has fetched the data from S/4, payloads will be generated in CPI based on the unique inspection lot number and sent to LIMS for further processing.*
7. *After fetching the inspection lot data, apply filter If entity: A\_InspectionLotWithStatus - InspectionLotStatusReleased = X or InspLotStatusCanceled = X then send to LIMS*
8. *After data is pushed to LIMS, an acknowledgement will be sent for each lot.*
9. *CPI will call a custom API to update the acknowledgement in the inspection lot user status.*

***Custom requirements to be included based on CR approval:***

- a. *Add and sort values of Source Batch and Inspection Lot fields in table QALS and QA32 output layout* ***(program RQEEAL10)*** *.*
- b. *Source batch and Lot fetching logic: If QALS-ART = TBD then Pass QALS – AUFNR to MSEG – AUFNR where BWART = 261 fetch MATNR, WERKS, CHARG.*

*Now pass MSEG - MATNR, WERKS, CHARG to QALS – SELMATNR, CHARG and WERK where HERKUNFT = 04, then consider successful record (Inspection lot (QALS-PRUEFLOS) and Batch number (QALS-CHARG)). If it is missing, then don’t send the data.*

- c. *Acknowledgement status should be updated in user status through custom API via CPI with the same conditions as above.*

*User Status Profile: ZQM\_LIMS*

| *User Status*   | *User Status Description(30Char)*   |
|-----------------|-------------------------------------|
| *STL (E0006)*   | *Sent to LIMS*                      |
| *PTL (E0007)*   | *Posted to LIMS*                    |

*Use FM: STATUS\_UPDATE*

*If Inspection lot* ***Sent to LIMS*** *:*

*Then pass following parameter in table JSET\_UPD*

*Pass OBJNR = QALS- OBJNR*

*STAT = E0006*

*INACT=*

*CHGNR =*

*Or*

***After posted to LIMS***

*Pass OBJNR = QALS- OBJNR*

*ESTAT\_INACTIVE = E0006*

*ESTAT\_ACTIVE = E0007*

*STSMA = ZQM\_LIMS*

*then commit the FM using BAPI\_TRANSACTION\_COMMIT.*

***Error Handling Process:***

*If Mandatory information is missing, then send the payload to LIMS. LIMS will take the decision whether accept the payload or not. In SAP, user will get to know from the report that if status is not changed then user will retrigger the API.*

*If it is failed due to connectivity or any other issue, no action required in SAP from CPI.*

****** After Successfully Posted the payload in LIMS then acknowledge required******

*Payload file format is JSON.*

### 4.1 Interface Details

*This section provides information relevant to the identified interface being requested via this functional specification.  This section captures both SAP &amp; Legacy system requirements.*

#### 4.1.1 Mapping and Transformation

*Update the below embedded attachment with source data structure, target data structure, and mapping and translation rules.*

SPARK\_FS\_P2P\_GAP21517\_LIMS Integration\_Inspection Lot SAP to LIMS - Outbound Fields &amp; Mapping Sheet

#### 4.1.2 Proposed Message Type /API

*API: API\_INSPECTIONLOT\_SRV*

**https://api.sap.com/api/OP\_API\_INSPECTIONLOT\_SRV\_0001/resource/Inspection\_Lot\_Data**

#### 4.1.3 4.1.3 Routing Rules

*Provide key fields and parameters that determine the data split.  If the source files/data need to be routed to different targets, describe the fields that would determine where to route the file/data and how the file/data would be parsed.*

It is not required

#### 4.1.4 Reprocessing

*Refers to the process of resubmitting messages or integration payloads that have previously failed during processing within an integration flow (iFlow). This function is essential for ensuring reliable data transfer and integration between systems, especially when temporary errors or issues prevent successful message delivery on the first attempt.*

It is not required

## 5 Security and Controls

### 5.1 Security Requirements

*Describe any security requirements that need to be put in place as a result of using this development object. This could include security access to affected transactions or new transactions that may result from this development.*

*For example - this section should answer the question “* ***Are there*** ~~***SOX  specific***~~ ***compliance requirements*** *?”*

- *Created files should be stored in a secured directory which is not modifiable by users (only system IDs)*
- *Also define any PII (GDPR, etc)  / Intellectual Property /* ~~*ITAR /*~~ *EAR and dual use restrictions (if any)*
- *Is the data considered sensitive? If so, how will the data be protected at rest, in transit , and in use (e.g. encryption, masking, tokenization; use of HTTPS, SFTP)?*

**High-level security requirements**

- OAuth 2.0 authentication required
- SSL/TLS encryption mandatory
- Service user with S\_INSP\_LOT authorization object
- Activity 03 (Display) for read operations
- Activity 02 (Change) for update operations

|   **Seq.** | **Security Questionnaire**                                                                          | **Yes/No/NA/Details**   |
|------------|-----------------------------------------------------------------------------------------------------|-------------------------|
|          1 | Is this an interface for Batch job or Business user?                                                | Yes - S_I_LIMS          |
|          2 | Does WRICEF object touch personal/sensitive information ?                                           | No                      |
|          3 | Does it require a custom t-code? If yes, does this provide maintain access, please provide details. | No                      |
|          4 | Does it require a custom authorization object? (Yes/No)                                             | No                      |
|          5 | Does it require specific authorization groups? (Yes/No)                                             | No                      |
|          6 | Authorization check statement (ABAP/BTP code) if any applicable?                                    | No                      |
|          7 | Is a Custom T-code required to run the custom program in PROD (No Access to SA38/SE38 in PROD) ?    | No                      |
|          8 | Is a Custom T-code required to maintain the custom table in PROD (No Access to SE16/SM30 in PROD) ? | No                      |
|          9 | Does any of the above require security role changes?                                                | No                      |
|         10 | Are there any key business /IT controls impacted? If yes, provide details.                          | No                      |
|         11 | Is this Custom Object a copy of a Standard Object ?                                                 |                         |
|         12 | Is this relevant for Segregation of Duties ?                                                        | No                      |

*Complete the table below to reflect security requirements on a high level.*

*If answer to Security Questionnaire no 9 is Yes, please fill out the following details:*

| **Business Role**   | **Activity**   | **Fiori Apps/Transaction Code(s)**   | **Level of Security**  **(M – Maintain)**  **(D- Display)**   |
|---------------------|----------------|--------------------------------------|---------------------------------------------------------------|
| Post Goods          | Posting GRN    | MIGO, COR6N, MFBF                    | M                                                             |

*If answer to Security Questionnaire no 12 is Yes, please fill out the following details:*

| Specify if access is internet-facing or cross-zone, and what protections apply   |
|----------------------------------------------------------------------------------|
|                                                                                  |

*If answer to Security Questionnaire no 14 is Yes, please fill out the following details:*

| If yes, specify location of the temporary files, access controls, and how automatic purging is set.   |
|-------------------------------------------------------------------------------------------------------|
|                                                                                                       |

￼

**Custom Tables / Programs**

*Complete the table below to reflect custom tables and programs to be secured (if any)*

| **Object Type**                                                                   | **Name**          | **Transaction Code**                                         | **Authorization Group**                               | **Level of Security**                                                                    |
|-----------------------------------------------------------------------------------|-------------------|--------------------------------------------------------------|-------------------------------------------------------|------------------------------------------------------------------------------------------|
| Indicate object  Object can be:  Program  Table  Message Type  Interface Scenario | Insert the object | List the custom transaction code that will be used to access | Enter the authorization group that should be assigned | List restrictions that should be in place (e.g., company code, sales organization, etc.) |

### 5.2 Monitoring and alert control

*Every interface must have an audit control that identifies, in the legacy system, the controls that must be balanced to the new system. This section should answer the question* ***“What is needed for audit control?”***

1. *Explain the reconciliation process to be in place to determine whether the data transferred completely and accurately.*
2. *Does this object turn off SAP’s standard change logging, if so, explain how changes will be captured elsewhere?*
3. *Explain how the interface is monitored (logging, monitoring cockpit,      detailed status report      automatically sent to the technical and business owner, … )*
4. *Explain the control totals, record counts, validation checks (e.g. are hash totals, line item totals, etc. needed) that are used to compare data transferred or extracted to help ensure completeness and accuracy of interfaced data.*
5. Standard SLG Log will be used (Tcode: SLG1)
6. Custom message: Source batch is missing

### 5.3 Data Encryption / Decryption Requirements

*Mention any special requirements for enhanced security (e.g., Salary, SSN etc.)*

## 6 Functional Unit Test Scenarios

*Complete functional unit testing of the object for a varied set of data.*

*Provide sample data from the test system / client which can be used to test this object. This section should answer the question “What sample test data can be used for testing?”*

|   **Step#** | **Test Type**   | **Scenario Title**                   | **Steps Performed**   | **Expected Results**   | **Actual Results**   |
|-------------|-----------------|--------------------------------------|-----------------------|------------------------|----------------------|
|           1 | Positive        | Send Inspection lot data             |                       |                        |                      |
|           2 | Negative        | Non LIMS plant – Inspection lot data |                       |                        |                      |

## 7 Attachments and Documentation

*Attach any additional information in the form of documentation / Appendix / attachments.*

*If answer to Security Questionnaire no 12 is Yes, please fill out the following details:*

*If answer to Security Questionnaire no 14 is Yes, please fill out the following details:*

**Custom Tables / Programs**

*Complete the table below to reflect custom tables and programs to be secured (if any)*

| **Object Type**                                                                   | **Name**          | **Transaction Code**                                         | **Authorization Group**                               | **Level of Security**                                                                    |
|-----------------------------------------------------------------------------------|-------------------|--------------------------------------------------------------|-------------------------------------------------------|------------------------------------------------------------------------------------------|
| Indicate object  Object can be:  Program  Table  Message Type  Interface Scenario | Insert the object | List the custom transaction code that will be used to access | Enter the authorization group that should be assigned | List restrictions that should be in place (e.g., company code, sales organization, etc.) |

### 7.1 Monitoring and alert control

***Every interface must have an audit control that identifies, in the legacy system, the controls that must be balanced to the new system. This section should answer the question “What is needed for audit control?”***

- *Explain the reconciliation process to be in place to determine whether the data transferred completely and accurately.*
- *Does this object turn off SAP’s standard change logging, if so, explain how changes will be captured elsewhere?*
- *Explain how the interface is monitored (logging, monitoring cockpit,      detailed status report      automatically sent to the technical and business owner, … )*
- *Explain the control totals, record counts, validation checks (e.g. are hash totals, line item totals, etc. needed) that are used to compare data transferred or extracted to help ensure completeness and accuracy of interfaced data.*
### 7.2 Data Encryption / Decryption Requirements

*Mention any special requirements for enhanced security (e.g., Salary, SSN etc.)*

## 8 Functional Unit Test Scenarios

*Complete functional unit testing of the object for a varied set of data.*

*Provide sample data from the test system / client which can be used to test this object. This section should answer the question “What sample test data can be used for testing?”*

| **Step#**   | **Test Type**   | **Scenario Title**   | **Steps Performed**   | **Expected Results**   | **Actual Results**   |
|-------------|-----------------|----------------------|-----------------------|------------------------|----------------------|
|             |                 |                      |                       |                        |                      |

## 9 Attachments and Documentation

*Attach any additional information in the form of documentation / Appendix / attachments.*