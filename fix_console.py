#!/usr/bin/env python3
import re

# Read the file
with open('/home/leigh_atkins/OpenPaint Clone/OpenPaint/public/js/paint.js', 'r') as f:
    content = f.read()

# Fix multiline console.log statements that are partially commented
lines = content.split('\n')
fixed_lines = []
i = 0

while i < len(lines):
    line = lines[i]
    
    # Check if this is a commented console.log with a comma at the end
    if re.match(r'^[^/]*//\s*console\.log.*,$', line):
        fixed_lines.append(line)
        i += 1
        
        # Comment out the following lines until we find the closing parenthesis
        while i < len(lines):
            line = lines[i]
            if re.match(r'^\s*[^/].*\);?\s*$', line):
                # This line is not commented but should be
                fixed_lines.append('//' + line)
                if ');' in line:
                    break
            else:
                fixed_lines.append(line)
            i += 1
    else:
        fixed_lines.append(line)
    
    i += 1

# Write the fixed content back
with open('/home/leigh_atkins/OpenPaint Clone/OpenPaint/public/js/paint.js', 'w') as f:
    f.write('\n'.join(fixed_lines))

print("Fixed multiline console.log statements")