import Base

law drop_b:
  for a: U32
  for b: U32
  U32

def drop_b(a, b):
  a

law main:
  U32

def main(): drop_b(2, 3)
