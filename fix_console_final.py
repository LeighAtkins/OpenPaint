#!/usr/bin/env python3
import re

# Read the file
with open('/home/leigh_atkins/OpenPaint Clone/OpenPaint/public/js/paint.js', 'r') as f:
    lines = f.readlines()

# Process the file line by line
fixed_lines = []
i = 0

while i < len(lines):
    line = lines[i].rstrip('\n')
    
    # Check if this line contains a commented console.log that continues
    if re.match(r'^[^/]*//\s*console\.log.*,$', line):
        fixed_lines.append(line)
        i += 1
        
        # Keep reading lines and commenting them until we find the end
        while i < len(lines):
            next_line = lines[i].rstrip('\n')
            # If it's not already commented and contains content, comment it
            if not re.match(r'^\s*//', next_line) and next_line.strip():
                fixed_lines.append('//' + next_line)
            else:
                fixed_lines.append(next_line)
            
            # Stop if we find the closing parenthesis and semicolon
            if ');' in next_line:
                break
            i += 1
    else:
        fixed_lines.append(line)
    
    i += 1

# Write the fixed content back
with open('/home/leigh_atkins/OpenPaint Clone/OpenPaint/public/js/paint.js', 'w') as f:
    for line in fixed_lines:
        f.write(line + '\n')

print("Fixed all multiline console.log statements")