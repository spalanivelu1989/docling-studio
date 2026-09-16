# Source data for Condition record for batch determination (for all areas)

## Introduction

Introduction to Data Migration Templates

Version SAP S/4HANA 2023 - Standard Scope - 10.04.2026 © Copyright SAP SE. All rights reserved.

Overview

A migration template (Microsoft Excel XML Spreadsheet 2003 file) consists of different sheets which are visible at the bottom of the migration template. You use the different sheets to specify the data that belongs to different data structures. For example the migration template for the migration object 'Product', contains a sheet for basic data, a sheet for plant data, and so on. Some sheets are mandatory, and some are optional.

A migration template is based on the active view of the relevant migration object. You can find information about the active view in the Microsoft Excel XML file. In the file, navigate to File -> Info. You can find the active view name under Properties -> Tags.

Prerequisites

In the Microsoft Excel XML Spreadsheet 2003 file, navigate to 'File' -> 'Options' -> 'Advanced'. Under the option 'When calculating this workbook:', ensure that the option 'Set precision as displayed' is selected.

Information about File Sizes

SAP S/4HANA Cloud

If you are migrating data to SAP S/4HANA Cloud, the default size limit for each uploaded XML file is 100MB.  If required, you can zip several files together. Note that the combined size of all the XML files you want to add to the zip file must not exceed 160MB.  The limit for zip file is still 100MB.

SAP S/4HANA On-Premise

If you are migrating data to SAP S/4HANA, the default size limit for each uploaded XML file is 100MB.

You can increase the size limit for each uploaded XML file to 160MB by changing the system parameter (icm/HTTP/max_request_size_KB). If required, you can zip several files together. Note that the combined size of all the XML files you want to add to the zip file must not exceed 160MB. The limit for the zip file is still 160 MB with the adjusted system parameter.

The Field List Sheet

The 'Field List' sheet is one of the first sheets in the migration template. You use this sheet to get an overview of the expected data in one central location.

It contains information about the mandatory and optional sheets, as well as detailed information for each sheet (for example the expected data type and length for the fields in each sheet).

On the 'Field List' sheet, you can view the following information for each field in the migration template:

| • | The name of the sheet, and whether it is mandatory or optional. Only mandatory sheets have the suffix 'Mandatory', for example 'Basic Data (Mandatory)'. All other sheets are optional. |
| --- | --- |
| Note: |  |
| You can quickly get an overview of the mandatory and optional sheets by looking at the color of the sheet names at the bottom of the migration template. The name of the mandatory sheets have the color orange, while the optional sheets have the color blue. |  |
| • | The group name for the fields in a sheet. |
| • | The individual fields in each sheet, as well as whether fields are mandatory for a sheet. |
| • | Information about the expected format of the individual fields, for example the data type and length. |
| Note: |  |
| In the field list sheet, certain technical information about the fields is hidden by default. The columns 'SAP Structure' and 'SAP Field' (columns 8 and 9) are hidden by default. The column 'SAP Structure' is the technical name of the structure that the field belongs to. The column 'SAP Field' is the technical name of the field. To unhide these columns, select the columns adjacent to either side of the columns that you want to unhide. Right-click your selection, and choose 'Unhide'. |  |
| If you want to extract data from SAP ERP, the technical name of structure and the technical name of the field often corresponds to the SAP ERP table name and field name. Also, the SAP Release Note (2568909) for SAP S/4HANA Cloud data migration content uses the technical names of the structures and fields. |  |
| Working with Sheets |  |
| For each migration template, you need to specify data for the mandatory sheets, and for the optional sheets that are relevant for your project: |  |
| • | Mandatory sheets (orange) |
| Mandatory sheets represent the minimum set of data you must provide for data migration. Fill in all mandatory fields. |  |
| • | Optional sheets (blue) |
| Use optional sheets depending on your migration scope and available legacy data. |  |
| Viewing Additional Information for Each Column |  |
| In row 8, you can view the field names in SAP S/4HANA, as well as additional information such as the expected format (for example the data type and length). Note that you must expand the row to view this additional information. |  |
| Some fields are mandatory, and some are optional. The wildcard character (‘*’) beside the name of a field indicates that the field is mandatory. |  |
| Note: |  |
| Although an optional sheet may contain mandatory columns, if the sheet is not relevant for your project, there is no need to fill the mandatory columns in the sheet with data. |  |
| Note: |  |
| Rows 4, 5, and 6 are hidden by default. Row 4 is the technical name of the structure (corresponds to the sheet name). Row 5 is the technical name of the field (corresponds to row 8 - the field description). Row 6 contains technical information such as the data type and length. |  |
| To unhide these rows, select the rows adjacent to either side of the rows that you want to unhide. Right-click your selection, and choose 'Unhide'. |  |
| Working with Different Data Types |  |
| You can view the data type for a field in row 8 (see 'Viewing Additional Information for Each Column' above). Depending on the field, one of the following data types may be required: |  |
| • | Text |
| Letters, numbers, and special characters are permitted. In the SAP S/4HANA migration cockpit, you can map the values of certain fields with the data type text (usually those fields with Length: 80) to their correct SAP S/4HANA target values. You can do this value mapping in the SAP S/4HANA migration cockpit when you start the transfer (in the step 'Convert Values'). |  |
| • | Number |
| Enter numbers with decimals in the relevant country-specific format, for example 12.34 (United States) or 12,34 (Germany). For fields with decimals, the declared length includes decimals (if required), for example if the information for the column states:  Length: 8, Decimals: 3, then a number such as 12345.678 is permitted. Note that decimal places are not mandatory. In this example, you can specify a whole number up to length 8 without decimal places, for example ‘1’. This number would be set to ‘1.000’ internally. For negative numbers, ensure that a minus sign ('-') directly precedes the number, for example '-100'. Note that currencies with more than 3 decimal places are not supported. |  |
| Note that the maximum field length supported by Microsoft Excel is 15 digits (including decimals). If you have longer numbers, use the option for transferring data to S/4HANA using staging tables. |  |
| • | Date |
| Enter the date in your country-specific format, for example 12/31/1998 (United States) or 31.12.1998 (Germany). Note that Microsoft Excel automatically recognizes different date formats and transforms them automatically to the correct XML format. |  |
| • | Time |
| Enter the time in the format HH:MM:SS, for example 02:52:40 |  |
| Copying Data to a Sheet |  |
| When copying data to a sheet from Microsoft Excel, always right-click the relevant cell and choose the paste option 'Values (V)'. Avoid pasting data that includes formatting and formulas into the migration template, as this will corrupt the structure of the XML migration template. |  |
| Using the Find and Replace Function |  |
| Do not use the Microsoft Excel function 'Find and Replace'. If you change data by using this function, you may also unintentionally change the field names and corrupt the structure of the XML migration template. |  |
| Saving the Migration Template |  |
| Ensure that you only save the migration template as a Microsoft Excel XML Spreadsheet 2003 file. Other file types are not supported by the SAP S/4HANA migration cockpit. |  |
| Important Information |  |
| Do not make any changes to the structure of the migration template, specifically: |  |
| • | Do not delete, rename or change the order of any sheet in the migration template. |
| • | Do not change the formatting of any cells. |
| • | Do not use formulas. |
| • | Do not hide, remove, or change the order of any of the columns in the migration template. |
| Note: |  |
| Any changes to the sheets will result in a corrupted XML structure. Such modified migration templates are not supported by the SAP S/4HANA migration cockpit. |  |

## Field List

Field List for Migration Object: Condition record for batch determination (for all areas)

Version SAP S/4HANA 2023 - Standard Scope - 10.04.2026 © Copyright SAP SE. All rights reserved.

| Sheet Name | Group Name | Field Description | Importance | Type | Length | Decimal | SAP Structure | SAP Field |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Condition Records (mandatory) |  |  |  |  |  |  |  |  |
|  | Key | Condition Record Number | mandatory for sheet | Text | 10 |  | S_BDT_HEADER | KNUMH |
|  | Condition Settings | Condition Type (Strategy Type) | mandatory for sheet | Text | 80 |  | S_BDT_HEADER | KSCHL |
|  |  | Application | mandatory for sheet | Text | 80 |  | S_BDT_HEADER | KAPPL |
|  | Condition Settings | Condition Table Number | mandatory for sheet | Text | 80 |  | S_BDT_HEADER | KOTABNR |
|  | Condition Settings | Sort Rule (Sort Sequence) |  | Text | 80 |  | S_BDT_HEADER | SRTSQ |
|  | Condition Settings | Class Name |  | Text | 80 |  | S_BDT_HEADER | CLASS_SEL |
|  | Validity | Validity Start Date | mandatory for sheet | Date |  |  | S_BDT_HEADER | DATAB |
|  | Validity | Validity End Date |  | Date |  |  | S_BDT_HEADER | DATBI |
|  | Selection Control | Selection Type |  | Text | 80 |  | S_BDT_HEADER | CHVSK |
|  | Selection Control | OB Purity (For Original Batches) |  | Text | 80 |  | S_BDT_HEADER | MILL_UCDET |
|  | Batch Split | No. of Batch Splits |  | Number | 3 |  | S_BDT_HEADER | CHASP |
|  | Batch Split | Indicator: Changes Allowed |  | Text | 1 |  | S_BDT_HEADER | CHSPL |
|  | Batch Split | Indicator: Overdelivery Allowed |  | Text | 1 |  | S_BDT_HEADER | CHVLL |
|  | Quantity Proposal | Quantity Proposal |  | Number | 3 |  | S_BDT_HEADER | CHMVS |
|  | Quantity Proposal | Indicator: Dialog Batch Determination |  | Text | 1 |  | S_BDT_HEADER | CHMDG |
|  | Quantity Proposal | Display UoM |  | Text | 80 |  | S_BDT_HEADER | KZAME |
| Condition Table Keys (mandatory) |  |  |  |  |  |  |  |  |
|  | Key | Condition Record No. | mandatory for sheet | Text | 10 |  | S_BDT_KEY | KNUMH |
|  | Key | Field Name | mandatory for sheet | Text | 30 |  | S_BDT_KEY | FIELDNAME |
|  | Condition Key | Field Value |  | Text | 100 |  | S_BDT_KEY | FIELDVALUE |
| Characteristics |  |  |  |  |  |  |  |  |
|  | Key | Number of Condition Record | mandatory for sheet | Text | 10 |  | S_BDT_CHARACT | KNUMH |
|  | Key | Characteristic Name | mandatory for sheet | Text | 80 |  | S_BDT_CHARACT | ATNAM |
|  | Key | Sequence Number | mandatory for sheet | Number | 4 |  | S_BDT_CHARACT | ITEM_NO |
|  | Allowed Values in Character Format | Characteristic Value (CHAR) |  | Text | 70 |  | S_BDT_CHARACT | ATWRT |
|  | NUM/CURR/DATE/TIME | Code for Value Dependency |  | Text | 1 |  | S_BDT_CHARACT | ATCOD |
|  | Allowed Values in Decimals Format | Internal Floating Point From |  | Number | 16 | 16 | S_BDT_CHARACT | ATFLV |
|  | Allowed Values in Decimals Format | Internal Floating Point To |  | Number | 16 | 16 | S_BDT_CHARACT | ATFLB |
|  | Allowed Values in Decimals Format | Base Unit of Measure From (ISO Format) |  | Text | 80 |  | S_BDT_CHARACT | ATAWE |
|  | Allowed Values in Decimals Format | Base Unit of Measure To (ISO Format) |  | Text | 80 |  | S_BDT_CHARACT | ATAW1 |
|  | Allowed Values in Date Format | Lower Boundary for Date-Interval |  | Date |  |  | S_BDT_CHARACT | DATE_FROM |
|  | Allowed Values in Date Format | Upper Boundary for Date-Interval |  | Date |  |  | S_BDT_CHARACT | DATE_TO |
|  | Allowed Values in Time Format | Lower Boundary for Time-Interval |  | Time |  |  | S_BDT_CHARACT | TIME_FROM |
|  | Allowed Values in Time Format | Upper Boundary for Time-Interval |  | Time |  |  | S_BDT_CHARACT | TIME_TO |

## Condition Records

Source Data for Migration Object:  Condition record for batch determination (for all areas)

Version SAP S/4HANA 2023 - Standard Scope - 10.04.2026 © Copyright SAP SE. All rights reserved.

S_BDT_HEADER

| KNUMH | KSCHL | KAPPL | KOTABNR | SRTSQ | CLASS_SEL | DATAB | DATBI | CHVSK | MILL_UCDET | CHASP | CHSPL | CHVLL | CHMVS | CHMDG | KZAME |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ETE;10;0;C;10;0 | ETE;80;0;C;80;0 | ETE;80;0;C;80;0 | ETE;80;0;C;80;0 | ETE;80;0;C;80;0 | ETE;80;0;C;80;0 | EDA;8;0;D;8;0 | EDA;8;0;D;8;0 | ETE;80;0;C;80;0 | ETE;80;0;C;80;0 | ENU;3;0;N;3;0 | ETE;1;0;C;1;0 | ETE;1;0;C;1;0 | ENU;3;0;N;3;0 | ETE;1;0;C;1;0 | ETE;80;0;C;80;0 |
| Key | Condition Settings |  | Condition Settings |  |  | Validity |  | Selection Control |  | Batch Split |  |  | Quantity Proposal |  |  |
| Condition Record Number*<br><br>Temporary number of your condition record. The record will be renumbered in the target system.<br>You can, for example enter the legacy key of your condition record.<br><br><br>Type: Text<br>Length: 10 | Condition Type (Strategy Type)*<br><br>Enter the condition type for this batch determination condition.<br><br>Type: Text<br>Length: 80 | Application*<br><br>Subdivides the usage of a condition (for example, pricing) for use in different application areas (for example, sales & distribution or purchasing).<br><br>Type: Text<br>Length: 80 | Condition Table Number*<br><br>Enter the condition table number for this batch determination condition.<br><br>Possible entries:<br>Material (001)<br>Customer/Material (002)<br>Customer/Plant/Material (003)<br>Plant (025)<br>...<br><br>Type: Text<br>Length: 80 | Sort Rule (Sort Sequence)<br><br>The sort sequence tells you whether objects in the search result of the Find Object function are sorted in ascending or descending order of characteristic values.<br><br>Type: Text<br>Length: 80 | Class Name<br><br>Name used to uniquely identify a class within a class type.<br><br>Type: Text<br>Length: 80 | Validity Start Date*<br><br>Date from which the condition is valid.<br><br>Type: Date | Validity End Date<br><br>End date (up to and including this date) of condition validity.<br>If the condition is not time-dependent, leave the field empty.<br><br><br>Type: Date | Selection Type<br><br>You use this key to determine whether batches are selected at the start of batch determination, and if so, how to select them.<br><br>Possible entries:<br>Immediate selection according to selection criteria (empty)<br>No selection at beginning of batch determination (N)<br>Selection with no selection criteria (O)<br>Selection criteria cannot be changed in batch determination (F)<br><br><br>Type: Text<br>Length: 80 | OB Purity (For Original Batches)<br><br>Determines whether batch determination should be carried out per original batch purity.<br><br>Possible entries:<br>None (0)<br>One component (1)<br>All components (2)<br><br>Type: Text<br>Length: 80 | No. of Batch Splits<br><br>The number of allowed batch splits during batch determination.<br><br>Type: Number<br>Length: 3 | Indicator: Changes Allowed<br><br>This is an indicator field. If the criterion is met, enter X. If not, leave the field empty.<br><br><br>Type: Text<br>Length: 1 | Indicator: Overdelivery Allowed<br><br>Allows the total of the split quantities of the batches found to be greater than the requested requirement quantity.<br><br>This is an indicator field. If the criterion is met, enter X. If not, leave the field empty.<br><br>Type: Text<br>Length: 1 | Quantity Proposal<br><br>This requirement specifies what quantities of what selected batches the system uses in order to fill the target quantity.<br><br>Type: Number<br>Length: 3 | Indicator: Dialog Batch Determination<br><br>Indicator which controls whether batch determination is to be run in the foreground.<br><br>If batch determination is to be run in the background, do not set the indicator, leave the field empty.<br>If batch determination is to be run in the foreground, i.e., if you want to be able to control the results of batch determination, set the indicator to 'X'.<br><br>Type: Text<br>Length: 1 | Display UoM<br><br>Indicator for the unit of measure in which the quantities are displayed during batch determination.<br>This can be either the basic unit of measure of the material or the unit of entry of the document for which batch determination is being carried out.<br><br>Possible entries:<br>Display in stockkeeping unit (A)<br>Display in unit of entry for document (B)<br><br>Type: Text<br>Length: 80 |
| 10001 | SD01 | V | KOTH002 | ZQM_FIFO |  | 2024-12-04 | 9999-12-31 | O |  | 999 | X | X | 1 | X |  |
| 10002 | SD01 | V | KOTH002 | ZQM_FIFO |  | 2023-01-01 | 9999-12-31 | O |  | 10 | X | X | 2 | X |  |
| 10003 | SD01 | V | KOTH002 | ZQM_FIFO |  | 2024-01-01 | 9999-12-31 | O |  | 0 | X | X | 1 | X |  |
| 10004 | SD01 | V | KOTH002 | ZQM_FIFO |  | 2024-12-30 | 9999-12-31 | O |  | 99 | X | X | 1 | X |  |

## Condition Table Keys

Source Data for Migration Object:  Condition record for batch determination (for all areas)

Version SAP S/4HANA 2023 - Standard Scope - 10.04.2026 © Copyright SAP SE. All rights reserved.

S_BDT_KEY

| KNUMH | FIELDNAME | FIELDVALUE |
| --- | --- | --- |
| ETE;10;0;C;10;0 | ETE;30;0;C;30;0 | ETE;100;0;C;100;0 |
| Key |  | Condition Key |
| Condition Record No.*<br><br>Temporary number of your condition record. The record will be renumbered in the target system.<br>You can, for example enter the legacy key of your condition record.<br><br><br>Type: Text<br>Length: 10 | Field Name*<br><br>Technical name of the key field defined in the condition table configuration, for example MATNR, KNDNR, and so on.<br>For a list of allowed field names please check the object documentation.<br><br>Type: Text<br>Length: 30 | Field Value<br><br>Enter the field value that corresponds to the field name.<br><br>Type: Text<br>Length: 100 |
| 10001 | KNDNR | 0400000011 |
| 10001 | MATNR | 1110000047 |
| 10002 | KNDNR | 0400000011 |
| 10002 | MATNR | 1200000046 |
| 10003 | KNDNR | BP1103 |
| 10003 | MATNR | 1200000012 |
| 10004 | KNDNR | 200000017 |
| 10004 | MATNR | 1110000029 |

## Characteristics

Source Data for Migration Object:  Condition record for batch determination (for all areas)

Version SAP S/4HANA 2023 - Standard Scope - 10.04.2026 © Copyright SAP SE. All rights reserved.

S_BDT_CHARACT

| KNUMH | ATNAM | ITEM_NO | ATWRT | ATCOD | ATFLV | ATFLB | ATAWE | ATAW1 | DATE_FROM | DATE_TO | TIME_FROM | TIME_TO |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ETE;10;0;C;10;0 | ETE;80;0;C;80;0 | ENU;4;0;N;4;0 | ETE;70;0;C;70;0 | ETE;1;0;C;1;0 | ENU;16;16;F;16;16 | ENU;16;16;F;16;16 | ETE;80;0;C;80;0 | ETE;80;0;C;80;0 | EDA;8;0;D;8;0 | EDA;8;0;D;8;0 | ETI;6;0;T;6;0 | ETI;6;0;T;6;0 |
| Key |  |  | Allowed Values in Character Format | NUM/CURR/DATE/TIME | Allowed Values in Decimals Format |  |  |  | Allowed Values in Date Format |  | Allowed Values in Time Format |  |
| Number of Condition Record*<br><br>Temporary number of your condition record. The record will be renumbered in the target system.<br>You can, for example enter the legacy key of your condition record.<br><br><br>Type: Text<br>Length: 10 | Characteristic Name*<br><br>Name that uniquely identifies a characteristic.<br><br>Type: Text<br>Length: 80 | Sequence Number*<br><br>The item number is to allow multiple values in each characteristic.<br><br>Please maintain a number from 1 to 9999 per multiple value.<br><br>Type: Number<br>Length: 4 | Characteristic Value (CHAR)<br><br>Enter here the value of the characteristic for data type CHAR.<br><br>Type: Text<br>Length: 70 | Code for Value Dependency<br><br>Relational operators to define the intervals with the following input options:<br> Code Operator Value1(Value From) Operator Value2(Value To)<br> 1 EQ =<br> 2 GE >= LT <<br> 3 GE >= LE <=<br> 4 GT > LT <<br> 5 GT > LE <=<br> 6 LT <<br> 7 LE <=<br> 8 GT ><br> 9 GE >=<br>For example:<br>VALUE_FROM: 20<br>VALUE_TO: 28<br>VALUE_RELATION: 2<br>Imported value: 20 - < 28<br><br><br>Type: Text<br>Length: 1 | Internal Floating Point From<br><br>Numerical Value from (Floating point)<br>NUM values can be entered with or without a decimal separator, for example 1000 or 1000.99.<br>Missing Decimals are automatically set when pressing Enter.<br><br>Type: Number<br>Length: 16<br>Decimal: 16 | Internal Floating Point To<br><br>Numerical Value to (Floating point) (only used in intervals)<br>NUM values can be entered with or without a decimal separator, for example 1000 or 1000.99.<br>Missing Decimals are automatically set by the Spreadsheet, when pressing Enter.<br><br>Type: Number<br>Length: 16<br>Decimal: 16 | Base Unit of Measure From (ISO Format)<br><br>Base Unit of Measure for "From" value in ISO 639 format.<br>If the unit of measurement (UoM) specified here does not equal the UoM of the characteristic, the output is converted into this UoM.<br><br><br>Type: Text<br>Length: 80 | Base Unit of Measure To (ISO Format)<br><br>Base Unit of Measure for "To" value in ISO 639 format.<br>If the unit of measurement (UoM) specified here does not equal the UoM of the characteristic, the output is converted into this UoM.<br><br><br>Type: Text<br>Length: 80 | Lower Boundary for Date-Interval<br><br>Lower boundary for a Date-Interval (DATE format)<br><br>Type: Date | Upper Boundary for Date-Interval<br><br>Higher boundary for a Date-Interval (DATE format)<br><br>Type: Date | Lower Boundary for Time-Interval<br><br>Lower boundary for a Time-Interval (TIME format)<br><br>Type: Time | Upper Boundary for Time-Interval<br><br>Higher boundary for a Time-Interval (TIME format)<br><br>Type: Time |
| 10001 | Z_QM_HSDAT1 | 1000 |  |  |  |  |  |  |  |  |  |  |
| 10002 | Z_QM_HSDAT1 | 1000 |  |  |  |  |  |  |  |  |  |  |
| 10003 | Z_QM_HSDAT1 | 1000 |  |  |  |  |  |  |  |  |  |  |
| 10004 | Z_QM_HSDAT1 | 1000 |  |  |  |  |  |  |  |  |  |  |
