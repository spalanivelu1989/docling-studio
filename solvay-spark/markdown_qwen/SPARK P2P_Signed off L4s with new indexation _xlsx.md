# SPARK P2P_Signed off L4s with new indexation 

## Final Signoff incl. new L4s

| L1 Name | L2 Name | L3 Name | L4 Name | Comments | Comment Deloitte | QA from PwC |
| --- | --- | --- | --- | --- | --- | --- |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.1 Manage BOM inventory | 7.1.1.1 Check for Material Availability | At which point should the material availability take place? (creation or release) It is not depicted in Celonis<br>5/6: After the creation before the release |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.1 Manage BOM inventory | 7.1.1.2 Expedite missing materials |  |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.1 Manage BOM inventory | 7.1.1.3 Schedule Consumable Material Requirements |  |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.10 Waste management | 7.1.10.1 Scrap Management | Is celonis updated? <br>5/6: 2 options based on whether an cost center is available or not |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.11 Material quantities reconcilation | 7.1.11.1 Correct the errors in goods movement |  |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.12 Repetitive manufacturing | 7.1.12.1 Staging/ Stock Transfers |  |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.12 Repetitive manufacturing | 7.1.12.2 Batch Determination in Repetitive Manufacturing | Which production lines will be monitored with repetitive manufacturing and for which material categories will batch determination be set?<br>5/6:<br>-Which is the criterion if the batch determination is manual or automatic?<br>-Repetitive all except BICAR related to pharma industry in Torre de la Vega<br>-The celonis should be enriched with the option of non batch-managed <br>- Confirm soda ash raw material is not batch-managed | Done |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.12 Repetitive manufacturing | 7.1.12.3 Production Declaration | Please specify how the information will be exchanged between MES and SAP. How will the batch nr be triggered?<br>5/6:<br>-Clarify Celonis flow, by adding batch creation moment, please | Done |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.12 Repetitive manufacturing | 7.1.12.4 Reconciliation and Correction of Errors |  |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.13 Tolling Manufacturing | 7.1.13.1 Create Tolling Orders | If toller is mapped as a plant an STO shouldn't be created? Celonis flow is not detailed<br>5/6:<br>-need to be moved to repetitive manuficturing<br>-add the shipping process to the toller, cross check with I2D and F2S | done | SPRINT 4 - SPARK-24718 |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.13 Tolling Manufacturing | 7.1.13.2 Confirm Orders |  |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.4 Execution of operations plan | 7.1.4.4 Confirm Process Order operation/Phase | Are User Statuses been used? Are there any by-products?<br>5/6: <br>-yes in by-products, probably no user status, to be checked<br>-update celonis flow | for MES they might create a user status but this is yet to be 100% confirmed | SPRINT 4 - SPARK-22780 |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.4 Execution of operations plan | 7.1.4.5 Backflush Raw Materials |  |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.4 Execution of operations plan | 7.1.4.6 Order Closure |  |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.4 Execution of operations plan | 7.1.4.2 Consume Material/Re-order Material |  |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.4 Execution of operations plan | 7.1.4.3 Reject Component Material |  |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.4 Execution of operations plan | 7.1.4.1 Process Instruction Record (EBR) |  |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.4 Execution of operations plan | 7.1.4.7 Energy Manufacturing Process | Analyse process. <br>5/6: Enrich Celonis with repetitive manufacturing and detailed steps, process manufacturing will be kept only for cogenerations | done |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.4 Execution of operations plan | 7.1.4.8 Energy Reconciliation Process | Analyse process.<br>5/6: Enrich Celonis with repetitive manufacturing and detailed steps (AP comment: collective orders could be used) Explain the first reconciliation step (7.1.12.4 Reconciliation and Correction of Errors) about consumptions BOM vs counters and the second one about consumption vs production which is specific for energy | Everything from Energy  reconciliation is done automicatally using a gap. |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.5 Process Order creation and release | 7.1.5.5 Complete Process Order | There is an flow change from the AS-IS, where the Batch ID will not be created anymore in MES side, but in SAP side.<br>SPARK 21753 FS doc missing even if it appears completed.<br>Is Celonis updated?<br>17/6 Celonis flow to be clarified with the exact point of the batch ID generation, in 7.1.5.4 Release Process Order | Done |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.5 Process Order creation and release | 7.1.5.1 Create Orders (Planned/Process) | Which production lines will be monitored with process orders?<br>17/6: There is no specific rule. There is a freedom to each plant. |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.5 Process Order creation and release | 7.1.5.4 Release Process Order |  |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.5 Process Order creation and release | 7.1.5.2 Plan Production Line Changes (Change Overs/Clean Outs) | Spark 22796 appears cancelled. Is the process not needed? Is Celonis updated?<br>17/6: CR SPARK-50658.<br>need to remove to from celonis | Done |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.5 Process Order creation and release | 7.1.5.3 Batch Determination for the Raw Material | The raw material for BICAR production will be batch-managed? According to Celonis there is Batch determination in raw materials. Is is for every production line?<br>17/6: No Raw material is batch managed (Check with Torrelavega/Rosigniano) |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.6 Production Process control analysis | 7.1.6.2 Perform In-line Inspection |  |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.6 Production Process control analysis | 7.1.6.1 Create In-Process Inspection Lot from Production |  |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.6 Production Process control analysis | 7.1.6.3 Results Recording In Process | All result reconding will take place in LIMS. The person responsible to maintain the respective master data for both systems will do it manually. There is no interface for QM master data creation. How will potencial errors be handled? Is Celonis updated about master data mainenance?<br>17/6: Check with Labware responsilble. Does SAP share a warning? | The inspection lots have a user status that indicates if the inspection lot was correctly sent to LIMS. In case not, the interface can be manually retriggered |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.7 Production receipt of bulk | 7.1.7.1 Perform final confirmation |  |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.8 Production receipt of packed product | 7.1.8.1 Print Production Labels |  |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.8 Production receipt of packed product | 7.1.8.2 Build Pallet |  |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.9 Defective production management | 7.1.9.1 Manage blocked stock |  |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.9 Defective production management | 7.1.9.3 Rework Material | For which produciton line(s) is rework applicable? Is the process finalized? Will a distinct process order be used? Is celonis updated?<br>-5/6: the approach will be distinct rework order. |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.9 Defective production management | 7.1.9.2 Contain material | Is celonis updated?<br>17/6: Does contain mean scrap? No, it's basically the step before where you normally segregate the material in one physical location before scrapping it |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.9 Defective production management | 7.1.9.4 Blend | Is celonis updated? It is not depicted where the batches will be defined for traceability reasons<br>17/6: add PP-REM flow, discuss it with Ninad to see how to apply it | Blending will only be processed using PP-PI. It will never be executed using PP-REM |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.9 Defective production management | 7.1.9.5 Reclassify Material |  |  |  |
| 06. P2P | 7.1 Produce/loading/packaging product | 7.1.9 Defective production management | 7.1.9.6 Contain as Off-Spec Material for Another Customer |  |  |  |
| 06. P2P | 7.2 Assess production performance | 7.2.1 Monitor and optimize production process | 7.2.1.1 Inventory Report |  |  |  |
| 06. P2P | 7.2 Assess production performance | 7.2.1 Monitor and optimize production process | 7.2.1.2 Master data report |  |  |  |
| 06. P2P | 7.2 Assess production performance | 7.2.1 Monitor and optimize production process | 7.2.1.3 Process order information system |  |  |  |
| 06. P2P | 7.3 Develop and maintain the Quality Management System (QMS) | 7.3.8 Quality management System review | 7.3.8.1 Supplier Non Conformity - Create QM Notification to Supplier |  |  |  |
| 06. P2P | 7.3 Develop and maintain the Quality Management System (QMS) | 7.3.8 Quality management System review | 7.3.8.2 Supplier Non Conformity -  Evaluate defects and QM notifications |  |  |  |
| 06. P2P | 7.3 Develop and maintain the Quality Management System (QMS) | 7.3.8 Quality management System review | 7.3.8.3 Supplier Non Conformity -  Assign Immediate Tasks & define Owner |  |  |  |
| 06. P2P | 7.3 Develop and maintain the Quality Management System (QMS) | 7.3.8 Quality management System review | 7.3.8.4 Supplier Non Conformity - Manage Email/Workflow to the Responsible |  |  |  |
| 06. P2P | 7.3 Develop and maintain the Quality Management System (QMS) | 7.3.8 Quality management System review | 7.3.8.6 Supplier Non Conformity -  Review tasks Completion, Assign the Causes and Close the NC |  |  |  |
| 06. P2P | 7.3 Develop and maintain the Quality Management System (QMS) | 7.3.8 Quality management System review | 7.3.8.5 Supplier Non Conformity -  Complete and document Tasks |  |  |  |
| 06. P2P | 7.3 Develop and maintain the Quality Management System (QMS) | 7.3.8 Quality management System review | 7.3.8.7 Notify Supplier/Source of Deviation |  |  |  |
| 06. P2P | 7.3 Develop and maintain the Quality Management System (QMS) | 7.3.8 Quality management System review | 7.3.8.9 Return Material to Supplier | Analyse the process eg: RR (with defect)->UD Rejected (MVT 122) or QN with action box. No Celonis flow.<br>17/6: Desscribe the process E2E in both cases with or W/o inspection lot, from inspction steps to return steps, highlighting the two different ways of managing the non conformity. Add the preliminary check who generated the NC, link 8.5 and 8.6 to another 8.x to create a full path | Done |  |
| 06. P2P | 7.3 Develop and maintain the Quality Management System (QMS) | 7.3.8 Quality management System review | 7.3.8.8 Issue Return Notice to supplier |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.10 Release products | 7.4.10.1 Complete Inspection Lot(UD) In Process Inspection |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.10 Release products | 7.4.10.2 Contain off-spec material (Quarantine) |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.10 Release products | 7.4.10.4 Post batch to unrestricted stock |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.10 Release products | 7.4.10.3 Complete Inspection Lot(UD) After Production Inspection |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.10 Release products | 7.4.10.5 Electronic Batch Record Release | EBR tool is cancelled. According to GMP regulation EBR should be monitored. How will it take place in SAP?<br>17/6: the tool never worked properly. In Torrelavega the APRM automation will remain. The UD will be managed with digital signature. The Dossier will be hard copied. we need to add the digital signature in Pharma flow in celonis. Edit the flow. | The flow for EBR is deleted and the digital signature is added to the 7.4.10.3 flow |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.11 Calibration Management | 7.4.11.1 Manage Calibration Inspection Lot |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.3 Maintain production /batch records and manage lot traceability | 7.4.3.1 Establish material as batch managed |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.3 Maintain production /batch records and manage lot traceability | 7.4.3.2 Define batch management data |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.3 Maintain production /batch records and manage lot traceability | 7.4.3.3 Establish batch numbering |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.3 Maintain production /batch records and manage lot traceability | 7.4.3.4 Establish batch determination |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.3 Maintain production /batch records and manage lot traceability | 7.4.3.8 Determine Batch Where Used List |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.3 Maintain production /batch records and manage lot traceability | 7.4.3.7 Manage Batch Reporting |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.3 Maintain production /batch records and manage lot traceability | 7.4.3.5 Activate batch derivation |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.5 Recurring inspections | 7.4.5.1 Activate shelf life expiry date | Is celonis updated?<br>17/6: Check if the autmatic generation flow of isnspection lots before expiry date is mentioned | The flow shows first that the inspection lot is automatically created. And then determines the expiry date |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.6 Reports | 7.4.6.1 Report for Quality results |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.7 Quality control of raw materials | 7.4.7.3 Generate Inspection lot for Partial PO Item |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.7 Quality control of raw materials | 7.4.7.8 Usage Decision Inbound (01) |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.7 Quality control of raw materials | 7.4.7.2 Create Inspection Lot from Purchase order |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.7 Quality control of raw materials | 7.4.7.7 Record Material Inspection results |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.7 Quality control of raw materials | 7.4.7.1 Identify Inspection/Quality Requirements for supplier QIR |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.7 Quality control of raw materials | 7.4.7.5 Visually Inspect Goods |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.7 Quality control of raw materials | 7.4.7.6 Document Results - Inbound certificate Check |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.7 Quality control of raw materials | 7.4.7.4 Perform Inspection/Sample Test Inbound |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.7 Quality control of raw materials | 7.4.7.9 Transfer Materials from Quality Inspection to Unrestricted Stock |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.7 Quality control of raw materials | 7.4.7.10 Reclassify Materials |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.7 Quality control of raw materials | 7.4.7.11 Notify Vendor of Material Rejection |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.7 Quality control of raw materials | 7.4.7.12 Determine Material Disposition |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.8 Quality Control of intermediates, finished products | 7.4.8.3 Restrict Batch of Product |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.8 Quality Control of intermediates, finished products | 7.4.8.2 Results Recording After Production |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.8 Quality Control of intermediates, finished products | 7.4.8.1 Create Inspection Lot from Production Goods Receipt |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.8 Quality Control of intermediates, finished products | 7.4.8.4 Quality Returns for Pack Products |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.8 Quality Control of intermediates, finished products | 7.4.8.5 LIMS Integration |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.9 Quality control during product bulk loading | 7.4.9.1 Create Inspection Lot from Delivery |  |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.9 Quality control during product bulk loading | 7.4.9.2 Results Recording In Bulk Loading | Is celonis updated? |  |  |
| 06. P2P | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4.9 Quality control during product bulk loading | 7.4.9.3 Quality Returns for Bulk Products | Analyse the process (inspection result w/o inspection lot, when and how will return order be created?) |  |  |
| 06. P2P | 7.5 Manage Plan to Produce Data | 7.5.1 Manage production master data | 7.5.1.1 Process Class |  |  |  |
| 06. P2P | 7.5 Manage Plan to Produce Data | 7.5.1 Manage production master data | 7.5.1.3 Mantain MRP and work scheduling views |  |  |  |
| 06. P2P | 7.5 Manage Plan to Produce Data | 7.5.1 Manage production master data | 7.5.1.4 Process Material Classification |  |  |  |
| 06. P2P | 7.5 Manage Plan to Produce Data | 7.5.1 Manage production master data | 7.5.1.5 Process Document | Analyse process. 5/6 DMS process |  |  |
| 06. P2P | 7.5 Manage Plan to Produce Data | 7.5.1 Manage production master data | 7.5.1.2 Process Material Master |  |  |  |
| 06. P2P | 7.5 Manage Plan to Produce Data | 7.5.1 Manage production master data | 7.5.1.6 Process BOM |  |  |  |
| 06. P2P | 7.5 Manage Plan to Produce Data | 7.5.1 Manage production master data | 7.5.1.7 Process Resource |  |  |  |
| 06. P2P | 7.5 Manage Plan to Produce Data | 7.5.1 Manage production master data | 7.5.1.8 Process Master recipe |  |  |  |
| 06. P2P | 7.5 Manage Plan to Produce Data | 7.5.1 Manage production master data | 7.5.1.9 Process Production version |  |  |  |
| 06. P2P | 7.5 Manage Plan to Produce Data | 7.5.1 Manage production master data | 7.5.1.14 Authorize Change | ECN for production and quality master data is strongly recommended for GMP compliance. BPOs informed us that GBUs decided that is not required. If master data maintainance is monitored from another tool, is this process updated in Celonis? Does this tool follow an authorisation process?<br>17/6: Process simple MDG. double check data related to pharma. |  |  |
| 06. P2P | 7.5 Manage Plan to Produce Data | 7.5.1 Manage production master data | 7.5.1.15 Execute Change | ECN for production and quality master data is strongly recommended for GMP compliance. BPOs informed us that GBUs decided that is not required. If master data maintainance is monitored from another tool, is this process updated in Celonis? Does this tool follow an authorisation process?<br>17/6: Process simple MDG. double check data related to pharma. |  |  |
| 06. P2P | 7.5 Manage Plan to Produce Data | 7.5.1 Manage production master data | 7.5.1.13 Process Resources Hierarchy |  |  |  |
| 06. P2P | 7.5 Manage Plan to Produce Data | 7.5.1 Manage production master data | 7.5.1.10 Process Rate Routing |  |  |  |
| 06. P2P | 7.5 Manage Plan to Produce Data | 7.5.1 Manage production master data | 7.5.1.11 Process Reference Operation Set |  |  |  |
| 06. P2P | 7.5 Manage Plan to Produce Data | 7.5.1 Manage production master data | 7.5.1.12 Process Reference Rate Routing Set |  |  |  |
| 06. P2P | 7.5 Manage Plan to Produce Data | 7.5.2 Manage Delivery master data | 7.5.2.1 Manage Certificate of Analysis master data |  |  |  |
| 06. P2P | 7.5 Manage Plan to Produce Data | 7.5.3 Manage Quality master data | 7.5.3.1 Process QM Master data |  |  |  |

## Sheet1

Open Issues

| Sprint 3 | 21137 | 21138 | col4 | col5 | col6 |
| --- | --- | --- | --- | --- | --- |
| Sprint 4 | 22804 | 21755 | 23276 | 21028 | 23199 |
| Sprint 5 |  |  |  |  |  |

## P2P CALM Extract

| Hierarchy | Title | Description | External Reference Name | External Reference ID | External Reference URL |
| --- | --- | --- | --- | --- | --- |
| 1 | Solvay Processes |  |  |  |  |
| 1.6 | 06. P2P | 06. P2P |  |  |  |
| 1.6.1 | 7.1 Produce/loading/packaging product | 7.1 Produce/loading/packaging product |  |  |  |
| 1.6.1.1 | 7.1.1 Manage BOM inventory | 7.1.1 Manage BOM inventory |  |  |  |
| 1.6.1.1.1 | 7.1.1.1 Check for Material Availability | 7.1.1.1 Check for Material Availability |  |  |  |
| 1.6.1.1.2 | 7.1.1.2 Expedite missing materials | 7.1.1.2 Expedite missing materials |  |  |  |
| 1.6.1.1.3 | 7.1.1.3 Schedule Consumable Material Requirements | 7.1.1.3 Schedule Consumable Material Requirements |  |  |  |
| 1.6.1.2 | 7.1.10 Waste management | 7.1.10 Waste management |  |  |  |
| 1.6.1.2.1 | 7.1.10.1 Scrap Management | 7.1.10.1 Scrap Management |  |  |  |
| 1.6.1.3 | 7.1.11 Material quantities reconcilation | 7.1.11 Material quantities reconcilation |  |  |  |
| 1.6.1.3.1 | 7.1.11.1 Correct the errors in goods movement | 7.1.11.1 Correct the errors in goods movement |  |  |  |
| 1.6.1.4 | 7.1.12 Repetitive manufacturing | 7.1.12 Repetitive manufacturing |  |  |  |
| 1.6.1.4.1 | 7.1.12.1 Staging/ Stock Transfers | 7.1.12.1 Staging/ Stock Transfers |  |  |  |
| 1.6.1.4.2 | 7.1.12.2 Batch Determination in Repetitive Manufacturing | 7.1.12.2 Batch Determination in Repetitive Manufacturing |  |  |  |
| 1.6.1.4.3 | 7.1.12.3 Production Declaration | 7.1.12.3 Production Declaration |  |  |  |
| 1.6.1.4.4 | 7.1.12.4 Reconciliation and Correction of Errors | 7.1.12.4 Reconciliation and Correction of Errors |  |  |  |
| 1.6.1.5 | 7.1.13 Tolling Manufacturing | 7.1.13 Tolling Manufacturing |  |  |  |
| 1.6.1.5.1 | 7.1.13.1 Create Tolling Orders | 7.1.13.1 Create Tolling Orders |  |  |  |
| 1.6.1.5.2 | 7.1.13.2 Confirm Orders | 7.1.13.2 Confirm Orders |  |  |  |
| 1.6.1.6 | 7.1.4 Execution of operations plan | 7.1.4 Execution of operations plan |  |  |  |
| 1.6.1.6.1 | 7.1.4.4 Confirm Process Order operation/Phase | 7.1.4.4 Confirm Process Order operation/Phase |  |  |  |
| 1.6.1.6.2 | 7.1.4.5 Backflush Raw Materials | 7.1.4.5 Backflush Raw Materials |  |  |  |
| 1.6.1.6.3 | 7.1.4.6 Order Closure | 7.1.4.6 Order Closure |  |  |  |
| 1.6.1.6.4 | 7.1.4.2 Consume Material/Re-order Material | 7.1.4.2 Consume Material/Re-order Material |  |  |  |
| 1.6.1.6.5 | 7.1.4.3 Reject Component Material | 7.1.4.3 Reject Component Material |  |  |  |
| 1.6.1.6.6 | 7.1.4.1 Process Instruction Record (EBR) | 7.1.4.1 Process Instruction Record (EBR) |  |  |  |
| 1.6.1.6.7 | 7.1.4.7 Energy Manufacturing Process | 7.1.4.7 Energy Manufacturing Process |  |  |  |
| 1.6.1.6.8 | 7.1.4.8 Energy Reconciliation Process | 7.1.4.8 Energy Reconciliation Process |  |  |  |
| 1.6.1.7 | 7.1.5 Process Order creation and release | 7.1.5 Process Order creation and release |  |  |  |
| 1.6.1.7.1 | 7.1.5.5 Complete Process Order | 7.1.5.5 Complete Process Order |  |  |  |
| 1.6.1.7.2 | 7.1.5.1 Create Orders (Planned/Process) | 7.1.5.1 Create Orders (Planned/Process) |  |  |  |
| 1.6.1.7.3 | 7.1.5.4 Release Process Order | 7.1.5.4 Release Process Order |  |  |  |
| 1.6.1.7.4 | 7.1.5.2 Plan Production Line Changes (Change Overs/Clean Outs) | 7.1.5.2 Plan Production Line Changes (Change Overs/Clean Outs) |  |  |  |
| 1.6.1.7.5 | 7.1.5.3  Batch Determination for the Raw Material | 7.1.5.3  Batch Determination for the Raw Material |  |  |  |
| 1.6.1.8 | 7.1.6 Production Process control analysis | 7.1.6 Production Process control analysis |  |  |  |
| 1.6.1.8.1 | 7.1.6.2 Perform In-line Inspection | 7.1.6.2 Perform In-line Inspection |  |  |  |
| 1.6.1.8.2 | 7.1.6.1 Create In-Process Inspection Lot from Production | 7.1.6.1 Create In-Process Inspection Lot from Production |  |  |  |
| 1.6.1.8.3 | 7.1.6.3 Results Recording In Process | 7.1.6.3 Results Recording In Process |  |  |  |
| 1.6.1.9 | 7.1.7 Production receipt of bulk | 7.1.7 Production receipt of bulk |  |  |  |
| 1.6.1.9.1 | 7.1.7.1 Perform final confirmation | 7.1.7.1 Perform final confirmation |  |  |  |
| 1.6.1.10 | 7.1.8 Production receipt of packed product | 7.1.8 Production receipt of packed product |  |  |  |
| 1.6.1.10.1 | 7.1.8.1 Print Production Labels | 7.1.8.1 Print Production Labels |  |  |  |
| 1.6.1.10.2 | 7.1.8.2 Build Pallet | 7.1.8.2 Build Pallet |  |  |  |
| 1.6.1.11 | 7.1.9 Defective production management | 7.1.9 Defective production management |  |  |  |
| 1.6.1.11.1 | 7.1.9.1 Manage blocked stock | 7.1.9.1 Manage blocked stock |  |  |  |
| 1.6.1.11.2 | 7.1.9.3 Rework Material | 7.1.9.3 Rework Material |  |  |  |
| 1.6.1.11.3 | 7.1.9.2 Contain material | 7.1.9.2 Contain material |  |  |  |
| 1.6.1.11.4 | 7.1.9.4 Blend | 7.1.9.4 Blend |  |  |  |
| 1.6.1.11.5 | 7.1.9.5 Reclassify Material | 7.1.9.5 Reclassify Material |  |  |  |
| 1.6.1.11.6 | 7.1.9.6 Contain as Off-Spec Material for Another Customer | 7.1.9.6 Contain as Off-Spec Material for Another Customer |  |  |  |
| 1.6.2 | 7.2 Assess production performance | 7.2 Assess production performance |  |  |  |
| 1.6.2.1 | 7.2.1 Monitor and optimize production process | 7.2.1 Monitor and optimize production process |  |  |  |
| 1.6.2.1.1 | 7.2.1.1 Inventory Report | 7.2.1.1 Inventory Report |  |  |  |
| 1.6.2.1.2 | 7.2.1.2 Master data report | 7.2.1.2 Master data report |  |  |  |
| 1.6.2.1.3 | 7.2.1.3 Process order information system | 7.2.1.3 Process order information system |  |  |  |
| 1.6.3 | 7.3 Develop and maintain the Quality Management System (QMS) | 7.3 Develop and maintain the Quality Management System (QMS) |  |  |  |
| 1.6.3.1 | 7.3.8 Quality management System review | 7.3.8 Quality management System review |  |  |  |
| 1.6.3.1.1 | 7.3.8.1 Supplier Non Conformity - Create QM Notification to Supplier | 7.3.8.1 Supplier Non Conformity - Create QM Notification to Supplier |  |  |  |
| 1.6.3.1.2 | 7.3.8.2 Supplier Non Conformity -  Evaluate defects and QM notifications | 7.3.8.2 Supplier Non Conformity -  Evaluate defects and QM notifications |  |  |  |
| 1.6.3.1.3 | 7.3.8.3 Supplier Non Conformity -  Assign Immediate Tasks & define Owner | 7.3.8.3 Supplier Non Conformity -  Assign Immediate Tasks & define Owner |  |  |  |
| 1.6.3.1.4 | 7.3.8.4 Supplier Non Conformity - Manage Email/Workflow to the Responsible | 7.3.8.4 Supplier Non Conformity - Manage Email/Workflow to the Responsible |  |  |  |
| 1.6.3.1.5 | 7.3.8.6 Supplier Non Conformity -  Review tasks Completion, Assign the Causes and Close the NC | 7.3.8.6 Supplier Non Conformity -  Review tasks Completion, Assign the Causes and Close the NC |  |  |  |
| 1.6.3.1.6 | 7.3.8.5 Supplier Non Conformity -  Complete and document Tasks | 7.3.8.5 Supplier Non Conformity -  Complete and document Tasks |  |  |  |
| 1.6.3.1.7 | 7.3.8.7 Notify Supplier/Source of Deviation | 7.3.8.7 Notify Supplier/Source of Deviation |  |  |  |
| 1.6.3.1.8 | 7.3.8.9 Return Material to Supplier | 7.3.8.9 Return Material to Supplier |  |  |  |
| 1.6.3.1.9 | 7.3.8.8 Issue Return Notice to supplier | 7.3.8.8 Issue Return Notice to supplier |  |  |  |
| 1.6.4 | 7.4 Monitor quality of finished products, raw materials and intermediate products | 7.4 Monitor quality of finished products, raw materials and intermediate products |  |  |  |
| 1.6.4.1 | 7.4.10 Release products | 7.4.10 Release products |  |  |  |
| 1.6.4.1.1 | 7.4.10.1 Complete Inspection Lot(UD) In Process Inspection | 7.4.10.1 Complete Inspection Lot(UD) In Process Inspection |  |  |  |
| 1.6.4.1.2 | 7.4.10.2 Contain off-spec material (Quarantine) | 7.4.10.2 Contain off-spec material (Quarantine) |  |  |  |
| 1.6.4.1.3 | 7.4.10.4 Post batch to unrestricted stock | 7.4.10.4 Post batch to unrestricted stock |  |  |  |
| 1.6.4.1.4 | 7.4.10.3 Complete Inspection Lot(UD) After Production Inspection | 7.4.10.3 Complete Inspection Lot(UD) After Production Inspection |  |  |  |
| 1.6.4.1.5 | 7.4.10.5 Electronic Batch Record Release | 7.4.10.5 Electronic Batch Record Release |  |  |  |
| 1.6.4.2 | 7.4.11 Calibration Management | 7.4.11 Calibration Management |  |  |  |
| 1.6.4.2.1 | 7.4.11.1 Manage Calibration Inspection Lot | 7.4.11.1 Manage Calibration Inspection Lot |  |  |  |
| 1.6.4.3 | 7.4.3 Maintain production /batch records and manage lot traceability | 7.4.3 Maintain production /batch records and manage lot traceability |  |  |  |
| 1.6.4.3.1 | 7.4.3.1 Establish material as batch managed | 7.4.3.1 Establish material as batch managed |  |  |  |
| 1.6.4.3.2 | 7.4.3.2 Define batch management data | 7.4.3.2 Define batch management data |  |  |  |
| 1.6.4.3.3 | 7.4.3.3 Establish batch numbering | 7.4.3.3 Establish batch numbering |  |  |  |
| 1.6.4.3.4 | 7.4.3.4 Establish batch determination | 7.4.3.4 Establish batch determination |  |  |  |
| 1.6.4.3.5 | 7.4.3.8 Determine Batch Where Used List | 7.4.3.8 Determine Batch Where Used List |  |  |  |
| 1.6.4.3.6 | 7.4.3.7 Manage Batch Reporting | 7.4.3.7 Manage Batch Reporting |  |  |  |
| 1.6.4.3.7 | 7.4.3.5 Activate batch derivation | 7.4.3.5 Activate batch derivation |  |  |  |
| 1.6.4.4 | 7.4.5 Recurring inspections | 7.4.5 Recurring inspections |  |  |  |
| 1.6.4.4.1 | 7.4.5.1 Activate shelf life expiry date | 7.4.5.1 Activate shelf life expiry date |  |  |  |
| 1.6.4.5 | 7.4.6 Reports | 7.4.6 Reports |  |  |  |
| 1.6.4.5.1 | 7.4.6.1 Report for Quality results | 7.4.6.1 Report for Quality results |  |  |  |
| 1.6.4.6 | 7.4.7 Quality control of raw materials | 7.4.7 Quality control of raw materials |  |  |  |
| 1.6.4.6.1 | 7.4.7.3 Generate Inspection lot for Partial PO Item | 7.4.7.3 Generate Inspection lot for Partial PO Item |  |  |  |
| 1.6.4.6.2 | 7.4.7.8 Usage Decision Inbound (01) | 7.4.7.8 Usage Decision Inbound (01) |  |  |  |
| 1.6.4.6.3 | 7.4.7.2 Create Inspection Lot from Purchase order | 7.4.7.2 Create Inspection Lot from Purchase order |  |  |  |
| 1.6.4.6.4 | 7.4.7.7 Record Material Inspection results | 7.4.7.7 Record Material Inspection results |  |  |  |
| 1.6.4.6.5 | 7.4.7.1 Identify Inspection/Quality Requirements for supplier QIR | 7.4.7.1 Identify Inspection/Quality Requirements for supplier QIR |  |  |  |
| 1.6.4.6.6 | 7.4.7.5 Visually Inspect Goods | 7.4.7.5 Visually Inspect Goods |  |  |  |
| 1.6.4.6.7 | 7.4.7.6 Document Results - Inbound certificate Check | 7.4.7.6 Document Results - Inbound certificate Check |  |  |  |
| 1.6.4.6.8 | 7.4.7.4 Perform Inspection/Sample Test Inbound | 7.4.7.4 Perform Inspection/Sample Test Inbound |  |  |  |
| 1.6.4.6.9 | 7.4.7.9 Transfer Materials from Quality Inspection to Unrestricted Stock | 7.4.7.9 Transfer Materials from Quality Inspection to Unrestricted Stock |  |  |  |
| 1.6.4.6.10 | 7.4.7.10 Reclassify Materials | 7.4.7.10 Reclassify Materials |  |  |  |
| 1.6.4.6.11 | 7.4.7.11 Notify Vendor of Material Rejection | 7.4.7.11 Notify Vendor of Material Rejection |  |  |  |
| 1.6.4.6.12 | 7.4.7.12 Determine Material Disposition | 7.4.7.12 Determine Material Disposition |  |  |  |
| 1.6.4.7 | 7.4.8 Quality Control of intermediates, finished products | 7.4.8 Quality Control of intermediates, finished products |  |  |  |
| 1.6.4.7.1 | 7.4.8.3 Restrict Batch of Product | 7.4.8.3 Restrict Batch of Product |  |  |  |
| 1.6.4.7.2 | 7.4.8.2 Results Recording After Production | 7.4.8.2 Results Recording After Production |  |  |  |
| 1.6.4.7.3 | 7.4.8.1 Create Inspection Lot from Production Goods Receipt | 7.4.8.1 Create Inspection Lot from Production Goods Receipt |  |  |  |
| 1.6.4.7.4 | 7.4.8.4 Quality Returns for Pack Products | 7.4.8.4 Quality Returns for Pack Products |  |  |  |
| 1.6.4.7.5 | 7.4.8.5 LIMS Integration | 7.4.8.5 LIMS Integration |  |  |  |
| 1.6.4.8 | 7.4.9 Quality control during product bulk loading | 7.4.9 Quality control during product bulk loading |  |  |  |
| 1.6.4.8.1 | 7.4.9.1 Create Inspection Lot from Delivery | 7.4.9.1 Create Inspection Lot from Delivery |  |  |  |
| 1.6.4.8.2 | 7.4.9.2 Results Recording In Bulk Loading | 7.4.9.2 Results Recording In Bulk Loading |  |  |  |
| 1.6.4.8.3 | 7.4.9.3 Quality Returns for Bulk Products | 7.4.9.3 Quality Returns for Bulk Products |  |  |  |
| 1.6.5 | 7.5 Manage Plan to Produce Data | 7.5 Manage Plan to Produce Data |  |  |  |
| 1.6.5.1 | 7.5.1 Manage production master data | 7.5.1 Manage production master data |  |  |  |
| 1.6.5.1.1 | 7.5.1.1 Process Class | 7.5.1.1 Process Class |  |  |  |
| 1.6.5.1.2 | 7.5.1.3 Mantain MRP and work scheduling views | 7.5.1.3 Mantain MRP and work scheduling views |  |  |  |
| 1.6.5.1.3 | 7.5.1.4 Process Material Classification | 7.5.1.4 Process Material Classification |  |  |  |
| 1.6.5.1.4 | 7.5.1.5 Process Document | 7.5.1.5 Process Document |  |  |  |
| 1.6.5.1.5 | 7.5.1.2 Process Material Master | 7.5.1.2 Process Material Master |  |  |  |
| 1.6.5.1.6 | 7.5.1.6 Process BOM | 7.5.1.6 Process BOM |  |  |  |
| 1.6.5.1.7 | 7.5.1.7 Process Resource | 7.5.1.7 Process Resource |  |  |  |
| 1.6.5.1.8 | 7.5.1.8 Process Master recipe | 7.5.1.8 Process Master recipe |  |  |  |
| 1.6.5.1.9 | 7.5.1.9 Process Production version | 7.5.1.9 Process Production version |  |  |  |
| 1.6.5.1.10 | 7.5.1.14 Authorize Change | 7.5.1.14 Authorize Change |  |  |  |
| 1.6.5.1.11 | 7.5.1.15 Execute Change | 7.5.1.15 Execute Change |  |  |  |
| 1.6.5.1.12 | 7.5.1.13 Process Resources Hierarchy | 7.5.1.13 Process Resources Hierarchy |  |  |  |
| 1.6.5.1.13 | 7.5.1.10 Process Rate Routing | 7.5.1.10 Process Rate Routing |  |  |  |
| 1.6.5.1.14 | 7.5.1.11 Process Reference Operation Set | 7.5.1.11 Process Reference Operation Set |  |  |  |
| 1.6.5.1.15 | 7.5.1.12 Process Reference Rate Routing Set | 7.5.1.12 Process Reference Rate Routing Set |  |  |  |
| 1.6.5.2 | 7.5.2 Manage Delivery master data | 7.5.2 Manage Delivery master data |  |  |  |
| 1.6.5.2.1 | 7.5.2.1 Manage Certificate of Analysis master data | 7.5.2.1 Manage Certificate of Analysis master data |  |  |  |
| 1.6.5.3 | 7.5.3 Manage Quality master data | 7.5.3 Manage Quality master data |  |  |  |
| 1.6.5.3.1 | 7.5.3.1 Process QM Master data | 7.5.3.1 Process QM Master data |  |  |  |
