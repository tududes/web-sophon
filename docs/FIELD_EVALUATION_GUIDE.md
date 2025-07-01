# WebSophon Field Evaluation Guide

A comprehensive guide to creating effective field evaluation criteria for WebSophon's LLM-powered analysis system.

## Overview

WebSophon uses advanced LLM (Large Language Model) technology to analyze screenshots and evaluate custom criteria you define. This guide will help you create precise, reliable evaluation fields that consistently produce accurate results.

## Field Anatomy

### Basic Structure
Each field consists of:
- **Field Name**: Human-readable identifier (e.g., "Login Required")
- **Description/Criteria**: Specific instructions for the LLM to evaluate

### Example Field
```
Name: "Cart Total Visible"
Criteria: "A shopping cart total amount is clearly displayed on the page, showing the sum of all items"
```

## Writing Effective Criteria

### 1. Be Specific and Measurable

**❌ Poor Example:**
```
Name: "Good Deal"
Criteria: "There's a good deal available"
```

**✅ Better Example:**
```
Name: "Discount Visible"
Criteria: "A percentage discount (like 20% OFF) or sale price is prominently displayed"
```

### 2. Focus on Visual Elements

**❌ Poor Example:**
```
Name: "Product Quality"
Criteria: "The product is high quality"
```

**✅ Better Example:**
```
Name: "Product Rating"
Criteria: "A star rating of 4.0 or higher is visible next to the product"
```

### 3. Use Clear, Unambiguous Language

**❌ Poor Example:**
```
Name: "Page Problems"
Criteria: "Something seems wrong with the page"
```

**✅ Better Example:**
```
Name: "Error Message"
Criteria: "An error message or warning text is displayed in red or with an error icon"
```

## Field Categories

### 1. Content Detection Fields

Identify specific content elements:

```
Name: "News Article"
Criteria: "A news article with headline, byline, and publication date is visible"

Name: "Video Content"
Criteria: "A video player with play button or video thumbnail is present"

Name: "Contact Form"
Criteria: "A contact form with multiple input fields and a submit button is visible"
```

### 2. State Detection Fields

Identify page or application states:

```
Name: "Login Required"
Criteria: "A login form or 'Sign In' button is prominently displayed"

Name: "Loading State"
Criteria: "Loading spinners, progress bars, or 'Please wait' messages are visible"

Name: "Empty Results"
Criteria: "A message indicating no results found or empty search results is displayed"
```

### 3. Interactive Element Fields

Identify buttons, links, and interactive components:

```
Name: "Add to Cart Available"
Criteria: "An 'Add to Cart' or 'Buy Now' button is visible and appears clickable"

Name: "Download Link"
Criteria: "A download button or link with file format indication (PDF, ZIP, etc.) is present"

Name: "Social Sharing"
Criteria: "Social media sharing buttons for platforms like Twitter, Facebook, or LinkedIn are visible"
```

### 4. Data/Metric Fields

Identify specific data points or metrics:

```
Name: "Price Under 50"
Criteria: "A price is displayed that is less than $50 or equivalent currency"

Name: "High Stock Count"
Criteria: "Product availability shows more than 10 items in stock"

Name: "Recent Date"
Criteria: "A date from within the last 7 days is displayed"
```

### 5. Alert/Notification Fields

Identify warnings, alerts, or notifications:

```
Name: "Security Warning"
Criteria: "A security warning, SSL certificate error, or privacy notice is displayed"

Name: "Cookie Notice"
Criteria: "A cookie consent banner or privacy policy notice is visible"

Name: "Update Available"
Criteria: "A notification about software updates or new versions is shown"
```

## Advanced Techniques

### 1. Contextual Evaluation

Include context for better accuracy:

```
Name: "Sale Price Active"
Criteria: "A sale price is shown with the original price crossed out or marked as 'was $X, now $Y'"

Name: "Featured Product"
Criteria: "A product is marked as 'Featured', 'Bestseller', or highlighted with a special badge"
```

### 2. Negative Conditions

Define what should NOT be present:

```
Name: "Not Sold Out"
Criteria: "The product does NOT show 'Sold Out', 'Out of Stock', or 'Unavailable' status"

Name: "No Errors"
Criteria: "No error messages, 404 pages, or failure notifications are visible"
```

### 3. Comparative Evaluation

Compare values or states:

```
Name: "Discounted Price"
Criteria: "The current price is lower than a crossed-out original price"

Name: "High Rating"
Criteria: "The displayed rating is above 4 stars or 80% positive"
```

## Common Patterns

### E-commerce Sites
```
Fields for online shopping:
- "Product Available": "Product shows as in stock and available for purchase"
- "Free Shipping": "Free shipping offer is displayed for this item"
- "Customer Reviews": "Customer reviews or ratings are visible below the product"
- "Return Policy": "Return or refund policy information is clearly stated"
```

### News/Content Sites
```
Fields for content monitoring:
- "Breaking News": "A 'Breaking News' banner or urgent news indicator is displayed"
- "Comment Section": "A comment section with user comments is visible below the article"
- "Related Articles": "Related or recommended articles are shown on the page"
- "Newsletter Signup": "A newsletter subscription form or signup prompt is present"
```

### Application Interfaces
```
Fields for web applications:
- "User Logged In": "User profile picture, name, or logout option is visible"
- "Notification Badge": "A notification counter or badge with unread count is displayed"
- "Search Results": "Search results with multiple items are shown on the page"
- "Settings Access": "A settings gear icon or configuration menu is accessible"
```

### Form and Input Fields
```
Fields for form interaction:
- "Required Fields": "Required form fields are marked with asterisks or 'required' labels"
- "Validation Errors": "Form validation errors or field-specific error messages are displayed"
- "Submit Enabled": "The submit button appears enabled and clickable"
- "Progress Indicator": "A form progress bar or step indicator is visible"
```

## LLM Integration

### How It Works
1. WebSophon captures a screenshot of the current page
2. Your field criteria are sent with the image to the LLM
3. The LLM analyzes the image against each criteria
4. Results are returned with true/false values and confidence scores

### Independent Evaluation
**Important**: Each screenshot is evaluated **independently** by the LLM. The system does not use previous evaluation results to influence the current analysis unless explicitly instructed in your field criteria. This ensures:
- Fresh, unbiased analysis of each screenshot
- No false positives from previous states
- Accurate detection based only on current visual state

To detect changes between evaluations, explicitly include comparison instructions in your field criteria (e.g., "Check if the price has increased compared to the previous evaluation")

### Expected Response Format
```json
{
  "fields": {
    "login_required": {
      "boolean": false,
      "probability": 0.05
    },
    "add_to_cart_available": {
      "boolean": true,
      "probability": 0.92
    }
  },
  "reason": "Add to cart button is clearly visible, no login prompt shown"
}
```

### Field Name Processing
Your friendly field names are automatically converted to API-compatible format:
- "Login Required" → "login_required"
- "Add to Cart Available" → "add_to_cart_available"
- Special characters are converted to underscores

## Testing and Optimization

### 1. Start Simple
Begin with basic, obvious criteria:
```
Name: "Page Loaded"
Criteria: "The page content is fully visible without loading screens"
```

### 2. Test with Known Results
Test fields on pages where you know the expected outcome:
- Run on a login page (should return true for "Login Required")
- Run on a product page (should return true for "Product Visible")

### 3. Refine Based on Results
If a field returns unexpected results:
- Make criteria more specific
- Add visual context
- Break complex criteria into multiple fields

### 4. Monitor Confidence Scores
- High confidence (>0.8): Criteria is clear and well-defined
- Medium confidence (0.5-0.8): Consider refining criteria
- Low confidence (<0.5): Criteria may be ambiguous or not visible

## Best Practices Summary

### ✅ Do:
- Use specific, visual criteria
- Focus on what's actually visible in screenshots
- Test fields on known pages first
- Use clear, unambiguous language
- Include context when needed
- Start simple and refine based on results

### ❌ Don't:
- Use subjective criteria ("good", "bad", "nice")
- Assume functionality (focus on visible elements)
- Create overly complex criteria
- Use criteria that require page interaction
- Ignore confidence scores in results
- Create duplicate or conflicting field names

## Troubleshooting

### Field Always Returns False
- Check if the criteria is actually visible in screenshots
- Make criteria more specific and measurable
- Verify the element appears in captured area
- Test with full-page capture if element is below fold

### Field Returns Inconsistent Results
- Criteria may be too subjective or ambiguous
- Add more specific visual indicators
- Break complex criteria into simpler parts
- Check if page content changes dynamically

### Low Confidence Scores
- Criteria may not be clearly visible
- Add more context to help LLM identify elements
- Ensure criteria describes visual appearance
- Consider if element is too small or unclear in screenshots

Remember: The goal is to create criteria that any human could evaluate by looking at a screenshot of the page. If you can clearly identify the element or condition visually, the LLM should be able to as well. 